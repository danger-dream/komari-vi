import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Flex, Text, TextArea } from '@radix-ui/themes'
import { toast } from 'sonner'
import RealmBinaryManager from './RealmBinaryManager'

const TemplateEditor = () => {
	const { t } = useTranslation()
	const [value, setValue] = useState('')
	const [loading, setLoading] = useState(false)

	const fetchTemplate = async () => {
		setLoading(true)
		try {
			const res = await fetch('/api/v1/forwards/realm/default-config')
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const body = await res.json()
			setValue(body.data?.template_toml || '')
		} catch (e: any) {
			toast.error(e?.message || 'Load failed')
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchTemplate()
	}, [])

	const save = async () => {
		try {
			const res = await fetch('/api/v1/forwards/realm/default-config', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ template_toml: value })
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			toast.success(t('forward.templateSaved'))
		} catch (e: any) {
			toast.error(e?.message || 'Save failed')
		}
	}

	return (
		<>
			<Card>
				<Flex justify="between" align="center" mb="3">
					<Text weight="bold">{t('forward.realmTemplate')}</Text>
					<Flex gap="2">
						<Button variant="ghost" onClick={fetchTemplate} disabled={loading}>
							{t('forward.refresh')}
						</Button>
						<Button onClick={save} disabled={loading}>
							{t('forward.submit')}
						</Button>
					</Flex>
				</Flex>
				<TextArea minRows={12} value={value} onChange={e => setValue(e.target.value)} />
			</Card>
			<RealmBinaryManager />
		</>
	)
}

export default TemplateEditor
