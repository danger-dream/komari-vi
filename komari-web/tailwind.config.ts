import type { Config } from 'tailwindcss'

const config: Config = {
	darkMode: 'selector',
	content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
	theme: {
		extend: {
			colors: {
				'vscode-bg': '#1e1e1e',
				'vscode-bg-light': '#252526',
				'vscode-bg-dark': '#181818',
				'vscode-border': '#333333',
				'vscode-focus-border': '#ff00ff', // Debug: Fuchsia
				'vscode-foreground': '#cccccc',
				'vscode-description-foreground': '#8a8a8a',
				'vscode-error-foreground': '#f48771',

				'vscode-editor-background': '#1e1e1e',
				'vscode-editor-foreground': '#cccccc',
				'vscode-editor-selection-background': '#3a3d41',

				'vscode-tabs-background': '#252526',
				'vscode-tab-active-background': '#1e1e1e',
				'vscode-tab-active-foreground': '#ffffff',
				'vscode-tab-inactive-background': '#2d2d2d',
				'vscode-tab-inactive-foreground': '#999999',
				'vscode-tab-dirty-indicator': '#e4e4e4',

				'vscode-panel-background': '#1e1e1e',
				'vscode-panel-border': '#333333',
				'vscode-panel-tab-active-border': '#e7e7e7',
				'vscode-panel-tab-active-foreground': '#e7e7e7',
				'vscode-panel-tab-inactive-foreground': '#cccccc',

				'vscode-button-background': '#0e639c',
				'vscode-button-foreground': '#ffffff',
				'vscode-button-hover-background': '#00ff00', // Debug: Lime Green
				'vscode-button-active-background': '#0a496f',

				'vscode-input-background': '#3c3c3c',
				'vscode-input-foreground': '#cccccc',
				'vscode-input-border': '#3c3c3c',
				'vscode-input-placeholder-foreground': '#8a8a8a'
			}
		}
	},
	plugins: []
}

export default config
