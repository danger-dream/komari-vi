import ThemeSwitch from './ThemeSwitch'
import ColorSwitch from './ColorSwitch'
import LanguageSwitch from './Language'
import LoginDialog from './Login'
import { IconButton } from '@radix-ui/themes'
import { GitHubLogoIcon } from '@radix-ui/react-icons'
import { Link } from 'react-router-dom'
import { usePublicInfo } from '@/contexts/PublicInfoContext'
import { useTranslation } from 'react-i18next'
const NavBar = () => {
	const { publicInfo } = usePublicInfo()
	const { t } = useTranslation()
	return (
		<nav className="nav-bar flex rounded-b-lg items-center gap-3 max-h-16 justify-end min-w-full p-2 px-4">
			<div className="mr-auto flex">
				{/* <img src="/assets/logo.png" alt="Komari Logo" className="w-10 object-cover mr-2 self-center"/> */}
				<Link to="/">
					<label className="text-3xl font-bold ">{publicInfo?.sitename}</label>
				</Link>
				<div className="hidden flex-row items-end md:flex">
					<div style={{ color: 'var(--accent-3)' }} className="border-solid border-r-2 mr-1 mb-1 w-2 h-2/3" />
					<label className="text-base font-bold" style={{ color: 'var(--accent-4)' }}>
						Komari Monitor
					</label>
				</div>
			</div>

			<IconButton
				variant="soft"
				onClick={() => {
					window.open('https://github.com/komari-monitor', '_blank')
				}}>
				<GitHubLogoIcon />
			</IconButton>
			<ThemeSwitch />
			<ColorSwitch />
			<LanguageSwitch />
			{publicInfo?.private_site ? (
				<LoginDialog
					autoOpen={publicInfo?.private_site}
					info={t('common.private_site')}
					onLoginSuccess={() => {
						window.location.reload()
					}}
				/>
			) : (
				<LoginDialog />
			)}
		</nav>
	)
}
export default NavBar
