package credentials

import (
	"errors"
	"fmt"
	"strings"

	"github.com/komari-monitor/komari/database/dbcore"
	"github.com/komari-monitor/komari/database/models"
	"github.com/komari-monitor/komari/utils/securestore"
	"gorm.io/gorm"
)

func List() ([]models.Credential, error) {
	db := dbcore.GetDBInstance()
	var list []models.Credential
	if err := db.Order("id desc").Find(&list).Error; err != nil {
		return nil, err
	}
	return list, nil
}

func Create(name, username string, typ models.CredentialType, secretPlain, remark string) (*models.Credential, error) {
	name = strings.TrimSpace(name)
	username = strings.TrimSpace(username)
	if name == "" || username == "" {
		return nil, fmt.Errorf("name/username required")
	}
	if typ != models.CredentialTypePassword && typ != models.CredentialTypeKey {
		return nil, fmt.Errorf("invalid credential type: %s", typ)
	}
	if strings.TrimSpace(secretPlain) == "" {
		return nil, fmt.Errorf("secret required")
	}
	key, err := securestore.GetOrCreateCredentialKey()
	if err != nil {
		return nil, err
	}
	enc, err := securestore.EncryptString(key, secretPlain)
	if err != nil {
		return nil, err
	}
	cred := &models.Credential{
		Name:      name,
		Username:  username,
		Type:      typ,
		SecretEnc: enc,
		Remark:    remark,
	}
	db := dbcore.GetDBInstance()
	if err := db.Create(cred).Error; err != nil {
		return nil, err
	}
	return cred, nil
}

func CreateWithPassphrase(name, username string, typ models.CredentialType, secretPlain, passphrasePlain, remark string) (*models.Credential, error) {
	name = strings.TrimSpace(name)
	username = strings.TrimSpace(username)
	if name == "" || username == "" {
		return nil, fmt.Errorf("name/username required")
	}
	if typ != models.CredentialTypePassword && typ != models.CredentialTypeKey {
		return nil, fmt.Errorf("invalid credential type: %s", typ)
	}
	if strings.TrimSpace(secretPlain) == "" {
		return nil, fmt.Errorf("secret required")
	}
	key, err := securestore.GetOrCreateCredentialKey()
	if err != nil {
		return nil, err
	}
	enc, err := securestore.EncryptString(key, secretPlain)
	if err != nil {
		return nil, err
	}
	passphraseEnc := ""
	if typ == models.CredentialTypeKey && strings.TrimSpace(passphrasePlain) != "" {
		passphraseEnc, err = securestore.EncryptString(key, passphrasePlain)
		if err != nil {
			return nil, err
		}
	}
	cred := &models.Credential{
		Name:          name,
		Username:      username,
		Type:          typ,
		SecretEnc:     enc,
		PassphraseEnc: passphraseEnc,
		Remark:        remark,
	}
	db := dbcore.GetDBInstance()
	if err := db.Create(cred).Error; err != nil {
		return nil, err
	}
	return cred, nil
}

func Update(id uint, name, username *string, typ *models.CredentialType, secretPlain *string, remark *string) (*models.Credential, error) {
	db := dbcore.GetDBInstance()
	var cred models.Credential
	if err := db.First(&cred, id).Error; err != nil {
		return nil, err
	}
	if name != nil {
		cred.Name = strings.TrimSpace(*name)
	}
	if username != nil {
		cred.Username = strings.TrimSpace(*username)
	}
	if typ != nil {
		if *typ != models.CredentialTypePassword && *typ != models.CredentialTypeKey {
			return nil, fmt.Errorf("invalid credential type: %s", *typ)
		}
		cred.Type = *typ
		if *typ != models.CredentialTypeKey {
			cred.PassphraseEnc = ""
		}
	}
	if secretPlain != nil {
		key, err := securestore.GetOrCreateCredentialKey()
		if err != nil {
			return nil, err
		}
		enc, err := securestore.EncryptString(key, *secretPlain)
		if err != nil {
			return nil, err
		}
		cred.SecretEnc = enc
	}
	if remark != nil {
		cred.Remark = *remark
	}
	if err := db.Save(&cred).Error; err != nil {
		return nil, err
	}
	return &cred, nil
}

func UpdatePassphrase(id uint, passphrasePlain *string) (*models.Credential, error) {
	db := dbcore.GetDBInstance()
	var cred models.Credential
	if err := db.First(&cred, id).Error; err != nil {
		return nil, err
	}
	if cred.Type != models.CredentialTypeKey {
		return nil, fmt.Errorf("passphrase only supported for key credential")
	}
	key, err := securestore.GetOrCreateCredentialKey()
	if err != nil {
		return nil, err
	}
	if passphrasePlain == nil || strings.TrimSpace(*passphrasePlain) == "" {
		cred.PassphraseEnc = ""
	} else {
		enc, err := securestore.EncryptString(key, *passphrasePlain)
		if err != nil {
			return nil, err
		}
		cred.PassphraseEnc = enc
	}
	if err := db.Save(&cred).Error; err != nil {
		return nil, err
	}
	return &cred, nil
}

func Delete(id uint) error {
	db := dbcore.GetDBInstance()
	return db.Delete(&models.Credential{}, id).Error
}

func Get(id uint) (*models.Credential, error) {
	db := dbcore.GetDBInstance()
	var cred models.Credential
	if err := db.First(&cred, id).Error; err != nil {
		return nil, err
	}
	return &cred, nil
}

func RevealSecret(id uint) (string, error) {
	cred, err := Get(id)
	if err != nil {
		return "", err
	}
	key, err := securestore.GetOrCreateCredentialKey()
	if err != nil {
		return "", err
	}
	plain, err := securestore.DecryptString(key, cred.SecretEnc)
	if err != nil {
		return "", err
	}
	return plain, nil
}

func RevealPassphrase(id uint) (string, error) {
	cred, err := Get(id)
	if err != nil {
		return "", err
	}
	if cred.PassphraseEnc == "" {
		return "", nil
	}
	key, err := securestore.GetOrCreateCredentialKey()
	if err != nil {
		return "", err
	}
	plain, err := securestore.DecryptString(key, cred.PassphraseEnc)
	if err != nil {
		return "", err
	}
	return plain, nil
}

func ValidateExists(id uint) error {
	db := dbcore.GetDBInstance()
	var count int64
	if err := db.Model(&models.Credential{}).Where("id = ?", id).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func IsNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
