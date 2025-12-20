import { DropdownMenu, IconButton } from '@radix-ui/themes'
import { useContext, type ReactNode } from 'react'
import { ThemeContext } from '../contexts/ThemeContext'
import { SunIcon } from '@radix-ui/react-icons'
import { useTranslation } from 'react-i18next'

interface ThemeSwitchProps {
	icon?: ReactNode
	content?: {
		light?: ReactNode
		dark?: ReactNode
		system?: ReactNode
	}
}

const ThemeSwitch = ({
	icon = (
		<IconButton variant="soft">
			<SunIcon />
		</IconButton>
	)
}: ThemeSwitchProps = {}) => {
	const { setAppearance } = useContext(ThemeContext)
	const [t] = useTranslation()
	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>{icon}</DropdownMenu.Trigger>
			<DropdownMenu.Content>
				<DropdownMenu.Item onSelect={() => setAppearance('light')}>{t('theme.light', 'Light')}</DropdownMenu.Item>
				<DropdownMenu.Item onSelect={() => setAppearance('dark')}>{t('theme.dark', 'Dark')}</DropdownMenu.Item>
				<DropdownMenu.Item onSelect={() => setAppearance('system')}>{t('theme.system', 'System')}</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	)
}

export default ThemeSwitch
