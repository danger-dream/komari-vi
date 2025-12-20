export type TagItemType = 'text' | 'price' | 'custom'

export interface PriceTagPayload {
  price: number
  currency: string
  billingCycle: number
  expiredAt: string | null
  transactionDate?: string | null
}

export interface TagItem {
  type?: TagItemType
  text: string
  color?: string | null
  payload?: PriceTagPayload | Record<string, any>
}


