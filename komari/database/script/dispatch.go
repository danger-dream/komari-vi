package script

import (
	"errors"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/ws"
)

type dependencySnippet struct {
	ID         uint   `json:"id"`
	Name       string `json:"name"`
	FolderID   *uint  `json:"folder_id"`
	ScriptBody string `json:"script_body"`
}

func loadDependencies(s *models.Script) ([]dependencySnippet, error) {
	if s == nil {
		return nil, errors.New("script is nil")
	}
	db := dbcore.GetDBInstance()
	allIDs := make(map[uint]struct{})
	if len(s.DependsOnScripts) > 0 {
		for _, id := range s.DependsOnScripts {
			allIDs[id] = struct{}{}
		}
	}
	if len(s.DependsOnFolders) > 0 {
		var folders []models.ScriptFolder
		_ = db.Find(&folders).Error
		folderIDs := expandFolderIDs(s.DependsOnFolders, folders)
		var folderScripts []models.Script
		if err := db.Where("folder_id IN ?", folderIDs).Find(&folderScripts).Error; err == nil {
			for _, item := range folderScripts {
				allIDs[item.ID] = struct{}{}
			}
		}
	}
	if len(allIDs) == 0 {
		return nil, nil
	}
	ids := make([]uint, 0, len(allIDs))
	for id := range allIDs {
		if id == s.ID {
			continue
		}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil, nil
	}
	var scripts []models.Script
	if err := db.Where("id IN ?", ids).Find(&scripts).Error; err != nil {
		return nil, err
	}
	deps := make([]dependencySnippet, 0, len(scripts))
	for _, item := range scripts {
		deps = append(deps, dependencySnippet{
			ID:         item.ID,
			Name:       item.Name,
			FolderID:   item.FolderID,
			ScriptBody: item.ScriptBody,
		})
	}
	return deps, nil
}

func expandFolderIDs(root []uint, allFolders []models.ScriptFolder) []uint {
	if len(root) == 0 {
		return nil
	}
	idSet := make(map[uint]struct{})
	for _, id := range root {
		idSet[id] = struct{}{}
	}
	children := make(map[uint][]uint)
	for _, f := range allFolders {
		if f.ParentID != nil {
			children[*f.ParentID] = append(children[*f.ParentID], f.ID)
		}
	}
	queue := append([]uint{}, root...)
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		for _, child := range children[id] {
			if _, ok := idSet[child]; !ok {
				idSet[child] = struct{}{}
				queue = append(queue, child)
			}
		}
	}
	result := make([]uint, 0, len(idSet))
	for id := range idSet {
		result = append(result, id)
	}
	return result
}

func DispatchScript(s *models.Script, targetClientUUIDs []string, triggerKind string, params map[string]interface{}) (string, error) {
	if s == nil {
		return "", errors.New("script is nil")
	}
	if len(targetClientUUIDs) == 0 {
		return "", errors.New("no target clients provided")
	}
	execID := uuid.New().String()
	deps, err := loadDependencies(s)
	if err != nil {
		return "", err
	}
	payload := map[string]interface{}{
		"message":      "script",
		"script_id":    s.ID,
		"exec_id":      execID,
		"name":         s.Name,
		"script_body":  s.ScriptBody,
		"trigger_kind": triggerKind,
		"trigger_name": s.TriggerName,
		"timeout_sec":  s.TimeoutSec,
		"dependencies": deps,
		"params":       params,
	}
	online := ws.GetConnectedClients()
	statuses := make(models.ScriptClientStatusList, 0, len(targetClientUUIDs))
	now := models.FromTime(time.Now())
	for _, cid := range targetClientUUIDs {
		if cid == "" {
			continue
		}
		st := models.ScriptClientStatus{
			ClientID:  cid,
			ExecID:    execID,
			UpdatedAt: now,
		}
		if conn, ok := online[cid]; ok && conn != nil {
			if err := conn.WriteJSON(payload); err != nil {
				log.Printf("failed to dispatch script %d to %s: %v", s.ID, cid, err)
				st.DispatchStatus = "error"
				st.ExecStatus = "failed"
				st.ErrorLog = err.Error()
			} else {
				st.DispatchStatus = "sent"
				st.ExecStatus = "pending"
			}
		} else {
			st.DispatchStatus = "offline"
			st.ExecStatus = "offline"
		}
		statuses = append(statuses, st)
	}
	merged := mergeClientStatuses(s.ClientStatus, statuses)
	if err := UpdateClientStatus(s.ID, merged); err != nil {
		log.Printf("failed to update client status for script %d: %v", s.ID, err)
	}
	return execID, nil
}

func mergeClientStatuses(existing models.ScriptClientStatusList, updates models.ScriptClientStatusList) models.ScriptClientStatusList {
	result := make(models.ScriptClientStatusList, 0, len(existing)+len(updates))
	index := make(map[string]int)
	for i, st := range existing {
		result = append(result, st)
		index[st.ClientID] = i
	}
	for _, st := range updates {
		if idx, ok := index[st.ClientID]; ok {
			result[idx] = st
		} else {
			result = append(result, st)
		}
	}
	return result
}
