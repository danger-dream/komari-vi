import { AgentVersionManager } from '@/components/admin/AgentVersionManager'
import { CredentialManagerPanel } from '@/components/admin/CredentialManagerDialog'
import { ConnectionAddressManager } from '@/components/admin/ConnectionAddressManager'
import { InstallScriptManager } from '@/components/admin/InstallScriptManager'
import { Card, Tabs, Text } from '@radix-ui/themes'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

export function ServerSettingsPanel() {
	const { t } = useTranslation()
	const [tab, setTab] = React.useState<'version' | 'script' | 'credential' | 'other'>('version')

	return (
		<Tabs.Root value={tab} onValueChange={v => setTab(v as any)}>
			<Tabs.List>
				<Tabs.Trigger value="version">{t('server.settings.version', '版本管理')}</Tabs.Trigger>
				<Tabs.Trigger value="script">{t('server.settings.script', '部署脚本管理')}</Tabs.Trigger>
				<Tabs.Trigger value="credential">{t('server.settings.credential', '凭据管理')}</Tabs.Trigger>
				<Tabs.Trigger value="other">{t('server.settings.other', '其他设置')}</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="version" className="mt-3">
				<AgentVersionManager />
			</Tabs.Content>
			<Tabs.Content value="script" className="mt-3">
				<InstallScriptManager />
			</Tabs.Content>
			<Tabs.Content value="credential" className="mt-3">
				<CredentialManagerPanel />
			</Tabs.Content>
			<Tabs.Content value="other" className="mt-3">
				<ConnectionAddressManager />
			</Tabs.Content>
		</Tabs.Root>
	)
}
