package lg

import (
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/komari-monitor/komari/database/clients"
	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type AuthorizationFilter struct {
	Mode string
}

type NodeWithAuth struct {
	AuthID        uint              `json:"auth_id"`
	AuthName      string            `json:"auth_name"`
	AuthMode      string            `json:"auth_mode"`
	Node          models.Client     `json:"node"`
	Tools         []string          `json:"tools"`
	ExpiresAt     *models.LocalTime `json:"expires_at"`
	MaxUsage      *int              `json:"max_usage"`
	UsedCount     int               `json:"used_count"`
	RemainingUses *int              `json:"remaining_uses"`
}

func validateNodesAreLinux(uuids []string) error {
	list, err := clients.GetClientsByUUIDs(uuids)
	if err != nil {
		return err
	}
	if len(list) != len(uuids) {
		return fmt.Errorf("部分节点不存在，无法授权")
	}
	for _, c := range list {
		if c.OS == "" {
			return fmt.Errorf("节点 %s 缺少操作系统信息，无法授权", c.UUID)
		}
		if !strings.Contains(strings.ToLower(c.OS), "linux") {
			return fmt.Errorf("节点 %s 非 Linux 系统，无法授权", c.UUID)
		}
	}
	return nil
}

func EnsureAuthorizationIndexes() {
	db := dbcore.GetDBInstance()
	// 删除可能存在的唯一索引，改为普通索引以支持同码多授权
	if db.Migrator().HasIndex(&models.LgAuthorization{}, "idx_lg_authorizations_code") {
		if err := db.Migrator().DropIndex(&models.LgAuthorization{}, "idx_lg_authorizations_code"); err != nil {
			log.Printf("drop idx_lg_authorizations_code failed: %v", err)
		}
	}
	if err := db.Migrator().CreateIndex(&models.LgAuthorization{}, "idx_lg_authorizations_code"); err != nil {
		log.Printf("create idx_lg_authorizations_code failed: %v", err)
	}
}

func validateTools(tools []string) error {
	if len(tools) == 0 {
		return errors.New("至少选择一种工具")
	}
	if err := ValidateToolList(tools); err != nil {
		return err
	}
	return nil
}

func ValidateTool(tool string) error {
	tool = strings.ToLower(tool)
	allowed := map[string]struct{}{}
	for _, t := range AllowedTools {
		allowed[t] = struct{}{}
	}
	if _, ok := allowed[tool]; !ok {
		return fmt.Errorf("不支持的工具: %s", tool)
	}
	return nil
}

func ValidateToolList(tools []string) error {
	allowed := map[string]struct{}{}
	for _, t := range AllowedTools {
		allowed[t] = struct{}{}
	}
	for _, t := range tools {
		if _, ok := allowed[strings.ToLower(t)]; !ok {
			return fmt.Errorf("不支持的工具: %s", t)
		}
	}
	return nil
}

func validateAuthorization(auth *models.LgAuthorization) error {
	if auth.Name == "" {
		return errors.New("名称不能为空")
	}
	if len(auth.Nodes) == 0 {
		return errors.New("至少选择一个节点")
	}
	// 标准化工具名为小写
	for i, t := range auth.Tools {
		auth.Tools[i] = strings.ToLower(t)
	}
	if err := validateNodesAreLinux(auth.Nodes); err != nil {
		return err
	}
	if err := validateTools(auth.Tools); err != nil {
		return err
	}
	mode := strings.ToLower(auth.Mode)
	if mode != "public" && mode != "code" {
		return errors.New("mode 仅支持 public/code")
	}
	auth.Mode = mode
	if mode == "public" {
		auth.Code = ""
	}
	if mode == "code" {
		if len(auth.Code) < 12 {
			return errors.New("授权码长度不足")
		}
	}
	if auth.MaxUsage != nil && *auth.MaxUsage <= 0 {
		return errors.New("使用次数需大于0")
	}
	return nil
}

func CreateAuthorization(auth *models.LgAuthorization) error {
	if err := validateAuthorization(auth); err != nil {
		return err
	}
	now := models.FromTime(time.Now())
	auth.CreatedAt = now
	auth.UpdatedAt = now
	return dbcore.GetDBInstance().Create(auth).Error
}

func UpdateAuthorization(auth *models.LgAuthorization) error {
	if auth.ID == 0 {
		return errors.New("缺少授权ID")
	}
	if err := validateAuthorization(auth); err != nil {
		return err
	}
	auth.UpdatedAt = models.FromTime(time.Now())
	return dbcore.GetDBInstance().Model(&models.LgAuthorization{}).Where("id = ?", auth.ID).Updates(auth).Error
}

func DeleteAuthorization(id uint) error {
	if id == 0 {
		return errors.New("缺少授权ID")
	}
	return dbcore.GetDBInstance().Delete(&models.LgAuthorization{}, id).Error
}

func ListAuthorizations(filter AuthorizationFilter) ([]models.LgAuthorization, error) {
	db := dbcore.GetDBInstance()
	var list []models.LgAuthorization
	query := db.Model(&models.LgAuthorization{})
	if filter.Mode != "" {
		query = query.Where("mode = ?", filter.Mode)
	}
	if err := query.Order("id desc").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

func GetAuthorizationByCode(code string) (*models.LgAuthorization, error) {
	var auth models.LgAuthorization
	err := dbcore.GetDBInstance().Where("code = ?", code).First(&auth).Error
	if err != nil {
		return nil, err
	}
	auth.Mode = strings.ToLower(auth.Mode)
	return &auth, nil
}

func ListAuthorizationsByCode(code string) ([]models.LgAuthorization, error) {
	var auths []models.LgAuthorization
	err := dbcore.GetDBInstance().Where("code = ?", code).Order("id asc").Find(&auths).Error
	if err != nil {
		return nil, err
	}
	for i := range auths {
		auths[i].Mode = strings.ToLower(auths[i].Mode)
	}
	return auths, nil
}

func GetAuthorizationByID(id uint) (*models.LgAuthorization, error) {
	var auth models.LgAuthorization
	if err := dbcore.GetDBInstance().First(&auth, id).Error; err != nil {
		return nil, err
	}
	auth.Mode = strings.ToLower(auth.Mode)
	return &auth, nil
}

func ContainsNode(auth *models.LgAuthorization, uuid string) bool {
	for _, n := range auth.Nodes {
		if n == uuid {
			return true
		}
	}
	return false
}

func AllowsTool(auth *models.LgAuthorization, tool string) bool {
	tool = strings.ToLower(tool)
	for _, t := range auth.Tools {
		if strings.EqualFold(strings.ToLower(t), tool) {
			return true
		}
	}
	return false
}

func IsAuthorizationActive(auth *models.LgAuthorization) bool {
	if auth == nil {
		return false
	}
	if auth.ExpiresAt != nil && time.Now().After(auth.ExpiresAt.ToTime()) {
		return false
	}
	if auth.MaxUsage != nil && auth.UsedCount >= *auth.MaxUsage {
		return false
	}
	return true
}

func calculateRemainingUsage(auth *models.LgAuthorization) *int {
	if auth.MaxUsage == nil {
		return nil
	}
	remain := *auth.MaxUsage - auth.UsedCount
	if remain < 0 {
		remain = 0
	}
	return &remain
}

type aggregatedUsage struct {
	MaxUsage  *int
	UsedCount int
	ExpiresAt *models.LocalTime
}

func mergeUsage(usages []aggregatedUsage) aggregatedUsage {
	var maxUsage *int
	totalUsed := 0
	var expires *models.LocalTime

	for _, u := range usages {
		if u.MaxUsage == nil {
			// 任意一条无上限即视为无限
			maxUsage = nil
		} else if maxUsage != nil {
			sum := *maxUsage + *u.MaxUsage
			maxUsage = &sum
		} else {
			val := *u.MaxUsage
			maxUsage = &val
		}

		totalUsed += u.UsedCount
		if expires == nil {
			expires = u.ExpiresAt
		} else if u.ExpiresAt == nil {
			expires = nil
		} else if expires != nil && expires.ToTime().Before(u.ExpiresAt.ToTime()) {
			expires = u.ExpiresAt
		}
	}

	return aggregatedUsage{
		MaxUsage:  maxUsage,
		UsedCount: totalUsed,
		ExpiresAt: expires,
	}
}

type AggregatedAuth struct {
	ID        uint
	Name      string
	Code      string
	Mode      string
	Tools     []string
	MaxUsage  *int
	UsedCount int
	ExpiresAt *models.LocalTime
}

func listActiveAuthorizationsByCode(code string) ([]models.LgAuthorization, error) {
	auths, err := ListAuthorizationsByCode(code)
	if err != nil {
		return nil, err
	}
	active := make([]models.LgAuthorization, 0, len(auths))
	for _, auth := range auths {
		if auth.Mode != "code" {
			continue
		}
		if IsAuthorizationActive(&auth) {
			active = append(active, auth)
		}
	}
	if len(active) == 0 {
		return nil, errors.New("授权不存在或已失效")
	}
	return active, nil
}

func aggregateAuthorizationsByCode(code string) ([]NodeWithAuth, *AggregatedAuth, error) {
	auths, err := listActiveAuthorizationsByCode(code)
	if err != nil {
		return nil, nil, err
	}

	// 汇总节点 uuid，避免重复查询
	uuidSet := map[string]struct{}{}
	for _, a := range auths {
		for _, n := range a.Nodes {
			uuidSet[n] = struct{}{}
		}
	}
	uuids := make([]string, 0, len(uuidSet))
	for u := range uuidSet {
		uuids = append(uuids, u)
	}

	if err := validateNodesAreLinux(uuids); err != nil {
		return nil, nil, err
	}

	nodes, err := clients.GetClientsByUUIDs(uuids)
	if err != nil {
		return nil, nil, err
	}
	nodeMap := make(map[string]models.Client, len(nodes))
	for _, n := range nodes {
		nodeMap[n.UUID] = n
	}

	// 汇总每个节点的工具、使用次数与到期时间
	nodeViews := make([]NodeWithAuth, 0, len(nodeMap))
	allTools := map[string]struct{}{}
	for uuid, node := range nodeMap {
		var usages []aggregatedUsage
		toolSet := map[string]struct{}{}
		for _, a := range auths {
			if !ContainsNode(&a, uuid) {
				continue
			}
			for _, t := range a.Tools {
				toolSet[strings.ToLower(t)] = struct{}{}
				allTools[strings.ToLower(t)] = struct{}{}
			}
			usages = append(usages, aggregatedUsage{
				MaxUsage:  a.MaxUsage,
				UsedCount: a.UsedCount,
				ExpiresAt: a.ExpiresAt,
			})
		}
		agg := mergeUsage(usages)
		var tools []string
		for t := range toolSet {
			tools = append(tools, t)
		}
		sort.Strings(tools)
		var remaining *int
		if agg.MaxUsage != nil {
			val := *agg.MaxUsage - agg.UsedCount
			if val < 0 {
				val = 0
			}
			remaining = &val
		}

		nodeViews = append(nodeViews, NodeWithAuth{
			AuthID:        auths[0].ID,
			AuthName:      auths[0].Name,
			AuthMode:      "code",
			Node:          node,
			Tools:         tools,
			ExpiresAt:     agg.ExpiresAt,
			MaxUsage:      agg.MaxUsage,
			UsedCount:     agg.UsedCount,
			RemainingUses: remaining,
		})
	}

	var allToolsList []string
	for t := range allTools {
		allToolsList = append(allToolsList, t)
	}
	sort.Strings(allToolsList)

	// 汇总整体用量
	var overallUsages []aggregatedUsage
	for _, a := range auths {
		overallUsages = append(overallUsages, aggregatedUsage{
			MaxUsage:  a.MaxUsage,
			UsedCount: a.UsedCount,
			ExpiresAt: a.ExpiresAt,
		})
	}
	overall := mergeUsage(overallUsages)

	return nodeViews, &AggregatedAuth{
		ID:        auths[0].ID,
		Name:      auths[0].Name,
		Code:      code,
		Mode:      "code",
		Tools:     allToolsList,
		MaxUsage:  overall.MaxUsage,
		UsedCount: overall.UsedCount,
		ExpiresAt: overall.ExpiresAt,
	}, nil
}

func ListPublicAvailableNodes() ([]NodeWithAuth, error) {
	auths, err := ListAuthorizations(AuthorizationFilter{Mode: "public"})
	if err != nil {
		return nil, err
	}
	var result []NodeWithAuth
	for _, auth := range auths {
		if !IsAuthorizationActive(&auth) {
			continue
		}
		nodes, err := clients.GetClientsByUUIDs(auth.Nodes)
		if err != nil {
			return nil, err
		}
		for _, node := range nodes {
			if node.OS == "" || !strings.Contains(strings.ToLower(node.OS), "linux") {
				continue
			}
			result = append(result, NodeWithAuth{
				AuthID:        auth.ID,
				AuthName:      auth.Name,
				AuthMode:      auth.Mode,
				Node:          node,
				Tools:         auth.Tools,
				ExpiresAt:     auth.ExpiresAt,
				MaxUsage:      auth.MaxUsage,
				UsedCount:     auth.UsedCount,
				RemainingUses: calculateRemainingUsage(&auth),
			})
		}
	}
	return result, nil
}

// VerifyCode 返回可用节点，但不扣减次数
func VerifyCode(code string) ([]NodeWithAuth, *models.LgAuthorization, error) {
	nodes, agg, err := aggregateAuthorizationsByCode(code)
	if err != nil {
		return nil, nil, err
	}
	auth := &models.LgAuthorization{
		ID:        agg.ID,
		Name:      agg.Name,
		Mode:      agg.Mode,
		Code:      agg.Code,
		Tools:     agg.Tools,
		ExpiresAt: agg.ExpiresAt,
		MaxUsage:  agg.MaxUsage,
		UsedCount: agg.UsedCount,
	}
	return nodes, auth, nil
}

// ConsumeAuthorization 校验并扣减一次使用次数（如配置）
func ConsumeAuthorization(authID uint, code string) (*models.LgAuthorization, error) {
	db := dbcore.GetDBInstance()
	var auth models.LgAuthorization
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&auth, authID).Error; err != nil {
			return err
		}
		if auth.Mode == "code" && auth.Code != code {
			return errors.New("授权码不匹配")
		}
		if !IsAuthorizationActive(&auth) {
			return errors.New("授权已失效或次数已用尽")
		}
		auth.UsedCount++
		auth.UpdatedAt = models.FromTime(time.Now())
		if err := tx.Model(&models.LgAuthorization{}).Where("id = ?", authID).Updates(map[string]interface{}{
			"used_count": auth.UsedCount,
			"updated_at": auth.UpdatedAt,
		}).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &auth, nil
}

// ConsumeAuthorizationByCode 会在同一授权码下选择符合节点、工具且仍有剩余次数/有效期的授权，并扣减一次
func ConsumeAuthorizationByCode(code, nodeUUID, tool string) (*models.LgAuthorization, error) {
	if strings.TrimSpace(code) == "" {
		return nil, errors.New("需要授权码")
	}
	tool = strings.ToLower(tool)
	db := dbcore.GetDBInstance()
	var used models.LgAuthorization
	err := db.Transaction(func(tx *gorm.DB) error {
		var auths []models.LgAuthorization
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("code = ? AND mode = ?", code, "code").Find(&auths).Error; err != nil {
			return err
		}
		candidates := make([]models.LgAuthorization, 0, len(auths))
		for _, a := range auths {
			a.Mode = strings.ToLower(a.Mode)
			if a.Mode != "code" {
				continue
			}
			if !IsAuthorizationActive(&a) {
				continue
			}
			if !ContainsNode(&a, nodeUUID) {
				continue
			}
			if !AllowsTool(&a, tool) {
				continue
			}
			candidates = append(candidates, a)
		}
		if len(candidates) == 0 {
			return errors.New("授权已失效或不允许该节点/工具")
		}

		sort.Slice(candidates, func(i, j int) bool {
			ri := calculateRemainingUsage(&candidates[i])
			rj := calculateRemainingUsage(&candidates[j])
			// 优先使用有限次的授权，避免无限制授权被抢占
			if ri != nil && rj == nil {
				return true
			}
			if ri == nil && rj != nil {
				return false
			}
			if ri != nil && rj != nil && *ri != *rj {
				return *ri > *rj
			}
			// 次优先到期时间更早的
			ti := time.Time{}
			if candidates[i].ExpiresAt != nil {
				ti = candidates[i].ExpiresAt.ToTime()
			}
			tj := time.Time{}
			if candidates[j].ExpiresAt != nil {
				tj = candidates[j].ExpiresAt.ToTime()
			}
			if !ti.Equal(tj) {
				if ti.IsZero() {
					return false
				}
				if tj.IsZero() {
					return true
				}
				return ti.Before(tj)
			}
			return candidates[i].ID < candidates[j].ID
		})

		chosen := candidates[0]
		chosen.UsedCount++
		chosen.UpdatedAt = models.FromTime(time.Now())
		if err := tx.Model(&models.LgAuthorization{}).Where("id = ?", chosen.ID).Updates(map[string]interface{}{
			"used_count": chosen.UsedCount,
			"updated_at": chosen.UpdatedAt,
		}).Error; err != nil {
			return err
		}
		used = chosen
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &used, nil
}
