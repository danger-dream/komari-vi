import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, Grid3X3, Table2, Moon, Sun, SunMoon, CircleUserIcon, Menu, DollarSign, SignalHigh, Link2, Layers } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useIsMobile } from '@/hooks/useMobile'
import { useConfigItem } from '@/config'
import { useTheme } from '@/hooks/useTheme'
import { useExchangeRate } from '@/contexts/ExchangeRateContext'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

interface HeaderProps {
	searchTerm: string
	setSearchTerm: (term: string) => void
}

export const Header = ({ searchTerm, setSearchTerm }: HeaderProps) => {
	const { rawAppearance, setAppearance, viewMode, setViewMode } = useTheme()
	const [isSearchOpen, setIsSearchOpen] = useState(false)
	const location = useLocation()
	const isInstancePage = location.pathname.startsWith('/instance')
	const isLatencyPage = location.pathname.startsWith('/latency')
	const isLatencyComparePage = location.pathname.startsWith('/latency/compare')
	const isLgPage = location.pathname.startsWith('/lg')
	const isMobile = useIsMobile()
	const enableTitle = useConfigItem('enableTitle')
	const sitename = useConfigItem('titleText')
	const enableLogo = useConfigItem('enableLogo')
	const logoUrl = useConfigItem('logoUrl')
	const enableSearchButton = useConfigItem('enableSearchButton')
	const enableAdminButton = useConfigItem('enableAdminButton')

	const { currentCurrency, switchCurrency, currencyOptions, getCurrencySymbol } = useExchangeRate()

	useEffect(() => {
		if (sitename) {
			document.title = sitename
		}
	}, [sitename])

	return (
		<header className="purcarte-blur border-b border-(--accent-a4) shadow-sm shadow-(color:--accent-a4) sticky top-0 flex items-center justify-center z-10">
			<div className="w-[90%] max-w-screen-2xl px-4 py-2 flex items-center justify-between">
				<div className="flex items-center theme-text-shadow text-accent-foreground">
					<a href="/" className="flex items-center gap-2 text-2xl font-bold">
						{enableLogo && logoUrl && <img src={logoUrl} alt="logo" className="h-8" />}
						{enableTitle && <span>{sitename}</span>}
					</a>
				</div>
				<div className="flex items-center space-x-2">
					{!isInstancePage && (
						<>
							{isMobile ? (
								<>
									{enableSearchButton && (
										<DropdownMenu modal={false}>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" size="icon" className="relative group">
													<Search className="size-5 text-primary" />
													{searchTerm && (
														<span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-(--accent-indicator) transform -translate-x-1/2"></span>
													)}
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent
												align="end"
												className="purcarte-blur border-(--accent-4)/50 rounded-xl w-[90vw] translate-x-[5vw] mt-[.5rem] max-w-screen-2xl">
												<div className="p-2">
													<Input
														type="search"
														placeholder="搜索服务器..."
														className="w-full"
														value={searchTerm}
														onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
													/>
												</div>
											</DropdownMenuContent>
										</DropdownMenu>
									)}
									<DropdownMenu modal={false}>
										<DropdownMenuTrigger asChild>
											<Button variant="ghost" size="icon" className="relative group">
												<Menu className="size-5 text-primary transition-transform duration-300 group-data-[state=open]:rotate-180" />
												<span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-(--accent-indicator) transform -translate-x-1/2 scale-0 transition-transform duration-300 group-data-[state=open]:scale-100"></span>
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" className="purcarte-blur mt-[.5rem] border-(--accent-4)/50 rounded-xl">
											<DropdownMenuItem onClick={() => setViewMode(viewMode === 'grid' ? 'table' : 'grid')}>
												{viewMode === 'grid' ? (
													<Table2 className="size-4 mr-2 text-primary" />
												) : (
													<Grid3X3 className="size-4 mr-2 text-primary" />
												)}
												<span>{viewMode === 'grid' ? '表格视图' : '网格视图'}</span>
											</DropdownMenuItem>
											<DropdownMenuSub>
												<DropdownMenuSubTrigger>
													{rawAppearance === 'light' ? (
														<Sun className="size-4 mr-2 text-primary" />
													) : rawAppearance === 'dark' ? (
														<Moon className="size-4 mr-2 text-primary" />
													) : (
														<SunMoon className="size-4 mr-2 text-primary" />
													)}
													<span>切换主题</span>
												</DropdownMenuSubTrigger>
												<DropdownMenuSubContent className="purcarte-blur border-(--accent-4)/50 rounded-xl">
													<DropdownMenuItem onClick={() => setAppearance('light')}>
														<Sun className="size-4 mr-2 text-primary" />
														<span>浅色模式</span>
													</DropdownMenuItem>
													<DropdownMenuItem onClick={() => setAppearance('dark')}>
														<Moon className="size-4 mr-2 text-primary" />
														<span>深色模式</span>
													</DropdownMenuItem>
													<DropdownMenuItem onClick={() => setAppearance('system')}>
														<SunMoon className="size-4 mr-2 text-primary" />
														<span>跟随系统</span>
													</DropdownMenuItem>
												</DropdownMenuSubContent>
											</DropdownMenuSub>
											<DropdownMenuSub>
												<DropdownMenuSubTrigger>
													<DollarSign className="size-4 mr-2 text-primary" />
													<span>货币切换</span>
												</DropdownMenuSubTrigger>
												<DropdownMenuSubContent className="purcarte-blur border-(--accent-4)/50 rounded-xl max-h-64 overflow-y-auto nice-scrollbar">
													{currencyOptions.map(currency => (
														<DropdownMenuItem
															key={currency}
															onClick={() => switchCurrency(currency)}
															className={currentCurrency === currency ? 'bg-accent/20' : ''}>
															<span className={currentCurrency === currency ? 'font-semibold text-primary' : ''}>{currency}</span>
														</DropdownMenuItem>
													))}
												</DropdownMenuSubContent>
											</DropdownMenuSub>
											<DropdownMenuItem asChild>
												<Link to="/latency" className="flex items-center">
													<SignalHigh className="size-4 mr-2 text-primary" />
													<span>延迟监控</span>
												</Link>
											</DropdownMenuItem>
											<DropdownMenuItem asChild>
												<Link to="/latency/compare" className="flex items-center">
													<Layers className="size-4 mr-2 text-primary" />
													<span>延迟对比</span>
												</Link>
											</DropdownMenuItem>
											<DropdownMenuItem asChild>
												<Link to="/lg" className="flex items-center">
													<Link2 className="size-4 mr-2 text-primary" />
													<span>Looking Glass</span>
												</Link>
											</DropdownMenuItem>
											{enableAdminButton && (
												<DropdownMenuItem asChild>
													<a href="/admin" target="_blank" rel="noopener noreferrer" className="flex items-center">
														<CircleUserIcon className="size-4 mr-2 text-primary" />
														<span>管理员</span>
													</a>
												</DropdownMenuItem>
											)}
										</DropdownMenuContent>
									</DropdownMenu>
								</>
							) : (
								<>
									<div
										className={`flex items-center transition-all duration-300 ease-in-out overflow-hidden transform ${
											isSearchOpen ? 'w-48 opacity-100' : 'w-0 opacity-0'
										}`}>
										<Input
											type="search"
											placeholder="搜索服务器..."
											className={`transition-all duration-300 ease-in-out ${!isSearchOpen && 'invisible'}`}
											value={searchTerm}
											onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
										/>
									</div>
									{enableSearchButton && (
										<Button variant="ghost" size="icon" className="relative group" onClick={() => setIsSearchOpen(!isSearchOpen)}>
											<Search className="size-5 text-primary" />
											{searchTerm && (
												<span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-(--accent-indicator) transform -translate-x-1/2"></span>
											)}
										</Button>
									)}
									<Button variant="ghost" size="icon" onClick={() => setViewMode(viewMode === 'grid' ? 'table' : 'grid')}>
										{viewMode === 'grid' ? <Table2 className="size-5 text-primary" /> : <Grid3X3 className="size-5 text-primary" />}
									</Button>
									<DropdownMenu modal={false}>
										<DropdownMenuTrigger asChild>
											<Button variant="ghost" size="icon">
												{rawAppearance === 'light' ? (
													<Sun className="size-5 text-primary" />
												) : rawAppearance === 'dark' ? (
													<Moon className="size-5 text-primary" />
												) : (
													<SunMoon className="size-5 text-primary" />
												)}
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" className="purcarte-blur mt-[.5rem] border-(--accent-4)/50 rounded-xl">
											<DropdownMenuItem onClick={() => setAppearance('light')}>
												<Sun className="size-4 mr-2 text-primary" />
												<span>浅色模式</span>
											</DropdownMenuItem>
											<DropdownMenuItem onClick={() => setAppearance('dark')}>
												<Moon className="size-4 mr-2 text-primary" />
												<span>深色模式</span>
											</DropdownMenuItem>
											<DropdownMenuItem onClick={() => setAppearance('system')}>
												<SunMoon className="size-4 mr-2 text-primary" />
												<span>跟随系统</span>
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
									<DropdownMenu modal={false}>
										<DropdownMenuTrigger asChild>
											<Button variant="ghost" className="h-9 px-2 min-w-20" title={`当前货币: ${currentCurrency}`}>
												<span className="text-primary">
													{getCurrencySymbol(currentCurrency)}
													&nbsp;
													{currentCurrency}
												</span>
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent
											align="end"
											className="purcarte-blur mt-[.5rem] border-(--accent-4)/50 rounded-xl max-h-64 overflow-y-auto nice-scrollbar">
											{currencyOptions.map(currency => (
												<DropdownMenuItem
													key={currency}
													onClick={() => switchCurrency(currency)}
													className={currentCurrency === currency ? 'bg-accent/20' : ''}>
													<span className={currentCurrency === currency ? 'font-semibold text-primary' : ''}>
														{getCurrencySymbol(currency)} &nbsp;
														{currency}
													</span>
												</DropdownMenuItem>
											))}
										</DropdownMenuContent>
									</DropdownMenu>
									<Link to="/latency">
										<Button variant={isLatencyPage && !isLatencyComparePage ? 'secondary' : 'ghost'} size="sm" className="gap-1" title="延迟监控">
											<SignalHigh className="size-4 text-primary" />
											<span className="hidden sm:inline">延迟监控</span>
										</Button>
									</Link>
									<Link to="/latency/compare">
										<Button variant={isLatencyComparePage ? 'secondary' : 'ghost'} size="sm" className="gap-1" title="延迟对比">
											<Layers className="size-4 text-primary" />
											<span className="hidden sm:inline">延迟对比</span>
										</Button>
									</Link>
									<Link to="/lg">
										<Button variant={isLgPage ? 'secondary' : 'ghost'} size="sm" className="gap-1" title="Looking Glass">
											<Link2 className="size-4 text-primary" />
											<span className="hidden sm:inline">Looking Glass</span>
										</Button>
									</Link>
									{enableAdminButton && (
										<a href="/admin" target="_blank" rel="noopener noreferrer">
											<Button variant="ghost" size="icon">
												<CircleUserIcon className="size-5 text-primary" />
											</Button>
										</a>
									)}
								</>
							)}
						</>
					)}
					{isInstancePage && (
						<>
							{isMobile ? (
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="icon" className="relative group">
											<Menu className="size-5 text-primary transition-transform duration-300 group-data-[state=open]:rotate-180" />
											<span className="absolute -bottom-1 left-1/2 w-1.5 h-1.5 rounded-full bg-primary transform -translate-x-1/2 scale-0 transition-transform duration-300 group-data-[state=open]:scale-100"></span>
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent
										align="end"
										className="animate-in slide-in-from-top-5 duration-300 purcarte-blur border-(--accent-4)/50 rounded-xl">
										<DropdownMenuSub>
											<DropdownMenuSubTrigger>
												{rawAppearance === 'light' ? (
													<Sun className="size-4 mr-2 text-primary" />
												) : rawAppearance === 'dark' ? (
													<Moon className="size-4 mr-2 text-primary" />
												) : (
													<SunMoon className="size-4 mr-2 text-primary" />
												)}
												<span>切换主题</span>
											</DropdownMenuSubTrigger>
											<DropdownMenuSubContent className="purcarte-blur border-(--accent-4)/50 rounded-xl">
												<DropdownMenuItem onClick={() => setAppearance('light')}>
													<Sun className="size-4 mr-2 text-primary" />
													<span>浅色模式</span>
												</DropdownMenuItem>
												<DropdownMenuItem onClick={() => setAppearance('dark')}>
													<Moon className="size-4 mr-2 text-primary" />
													<span>深色模式</span>
												</DropdownMenuItem>
												<DropdownMenuItem onClick={() => setAppearance('system')}>
													<SunMoon className="size-4 mr-2 text-primary" />
													<span>跟随系统</span>
												</DropdownMenuItem>
											</DropdownMenuSubContent>
										</DropdownMenuSub>
										<DropdownMenuItem asChild>
											<Link to="/latency" className="flex items-center">
												<SignalHigh className="size-4 mr-2 text-primary" />
												<span>延迟监控</span>
											</Link>
										</DropdownMenuItem>
										<DropdownMenuItem asChild>
											<Link to="/latency/compare" className="flex items-center">
												<Layers className="size-4 mr-2 text-primary" />
												<span>延迟对比</span>
											</Link>
										</DropdownMenuItem>
										<DropdownMenuItem asChild>
											<Link to="/lg" className="flex items-center">
												<Link2 className="size-4 mr-2 text-primary" />
												<span>Looking Glass</span>
											</Link>
										</DropdownMenuItem>
										{enableAdminButton && (
											<DropdownMenuItem asChild>
												<a href="/admin" target="_blank" rel="noopener noreferrer" className="flex items-center">
													<CircleUserIcon className="size-4 mr-2 text-primary" />
													<span>管理员</span>
												</a>
											</DropdownMenuItem>
										)}
									</DropdownMenuContent>
								</DropdownMenu>
							) : (
								<>
									<DropdownMenu modal={false}>
										<DropdownMenuTrigger asChild>
											<Button variant="ghost" size="icon">
												{rawAppearance === 'light' ? (
													<Sun className="size-5 text-primary" />
												) : rawAppearance === 'dark' ? (
													<Moon className="size-5 text-primary" />
												) : (
													<SunMoon className="size-5 text-primary" />
												)}
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" className="purcarte-blur mt-[.5rem] border-(--accent-4)/50 rounded-xl">
											<DropdownMenuItem onClick={() => setAppearance('light')}>
												<Sun className="size-4 mr-2 text-primary" />
												<span>浅色模式</span>
											</DropdownMenuItem>
											<DropdownMenuItem onClick={() => setAppearance('dark')}>
												<Moon className="size-4 mr-2 text-primary" />
												<span>深色模式</span>
											</DropdownMenuItem>
											<DropdownMenuItem onClick={() => setAppearance('system')}>
												<SunMoon className="size-4 mr-2 text-primary" />
												<span>跟随系统</span>
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
									<Link to="/latency">
										<Button variant={isLatencyPage && !isLatencyComparePage ? 'secondary' : 'ghost'} size="sm" className="gap-1" title="延迟监控">
											<SignalHigh className="size-4 text-primary" />
											<span className="hidden sm:inline">延迟监控</span>
										</Button>
									</Link>
									<Link to="/latency/compare">
										<Button variant={isLatencyComparePage ? 'secondary' : 'ghost'} size="sm" className="gap-1" title="延迟对比">
											<Layers className="size-4 text-primary" />
											<span className="hidden sm:inline">延迟对比</span>
										</Button>
									</Link>
									<Link to="/lg">
										<Button variant={isLgPage ? 'secondary' : 'ghost'} size="sm" className="gap-1" title="Looking Glass">
											<Link2 className="size-4 text-primary" />
											<span className="hidden sm:inline">Looking Glass</span>
										</Button>
									</Link>
									{enableAdminButton && (
										<a href="/admin" target="_blank" rel="noopener noreferrer">
											<Button variant="ghost" size="icon">
												<CircleUserIcon className="size-5 text-primary" />
											</Button>
										</a>
									)}
								</>
							)}
						</>
					)}
				</div>
			</div>
		</header>
	)
}
