import path from 'path'
import fs from 'fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd())

	return {
		plugins: [
			react(),
			tailwindcss(),
			{
				name: 'exclude-examples',
				apply: 'build',
				writeBundle(options) {
					if (options.dir) {
						const examplesDir = path.resolve(options.dir, 'examples')
						if (fs.existsSync(examplesDir)) {
							fs.rmSync(examplesDir, { recursive: true, force: true })
						}
					}
				}
			}
		],
		resolve: {
			alias: {
				'@': path.resolve(__dirname, './src')
			}
		},
		build: {
			assetsDir: 'assets',
			outDir: 'dist',
			rollupOptions: {
				output: {
					// go embed ignore files start with '_'
					chunkFileNames: 'assets/chunk-[name]-[hash].js',
					entryFileNames: 'assets/entry-[name]-[hash].js',
					manualChunks: {
						'react-vendor': ['react', 'react-dom']
					}
				}
			}
		},
		server: {
			host: '127.0.0.1',
			port: 15151,
			proxy: {
				'/api': {
					target: env.VITE_API_TARGET || 'http://127.0.0.1:25774',
					changeOrigin: true,
					ws: true,
					secure: false
				}
			}
		}
	}
})
