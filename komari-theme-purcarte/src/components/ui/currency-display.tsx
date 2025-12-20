import React, { useMemo } from 'react'
import { cn } from '@/utils'
import { useExchangeRate } from '@/contexts/ExchangeRateContext'
import type { NodeData } from '@/types/node'

interface CurrencyDisplayProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** 价格 */
  price: number
  /** 原始货币 */
  currency: string
  /** 计费周期（天数） */
  billingCycle: number
  /** 自定义目标货币（覆盖全局设置） */
  targetCurrency?: string
  /** 是否显示货币符号（覆盖全局设置） */
  showSymbol?: boolean
  /** 显示类型 */
  type?: 'price' | 'amount'
  /** 额外的样式类名 */
  className?: string
}

export const CurrencyDisplay: React.FC<CurrencyDisplayProps> = ({
  price,
  currency,
  billingCycle,
  targetCurrency,
  showSymbol,
  type = 'price',
  className,
  ...props
}) => {
  const {
    formatPriceWithConversion,
    formatCurrencyWithConversion,
    isRatesAvailable,
    loading
  } = useExchangeRate()

  const displayValue = useMemo(() => {
    if (loading) return '...'
    
    if (type === 'price') {
      return formatPriceWithConversion(price, currency, billingCycle, targetCurrency)
    } else {
      return formatCurrencyWithConversion(price, currency, targetCurrency, {
        showSymbol
      })
    }
  }, [
    price,
    currency,
    billingCycle,
    targetCurrency,
    showSymbol,
    type,
    formatPriceWithConversion,
    formatCurrencyWithConversion,
    loading
  ])

  return (
    <span
      className={cn(
        'inline-flex items-center',
        loading && 'opacity-75',
        className
      )}
      title={isRatesAvailable ? `原价: ${currency}${price.toFixed(2)}` : undefined}
      {...props}
    >
      {displayValue}
    </span>
  )
}

interface RemainingValueDisplayProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 节点数据 */
  node: NodeData
  /** 自定义目标货币 */
  targetCurrency?: string
  /** 是否显示货币符号 */
  showSymbol?: boolean
  /** 额外的样式类名 */
  className?: string
}

export const RemainingValueDisplay: React.FC<RemainingValueDisplayProps> = ({
  node,
  targetCurrency,
  showSymbol,
  className,
  ...props
}) => {
  const {
    calculateRemainingValueWithConversion,
    formatCurrencyWithConversion,
    isRatesAvailable,
    loading
  } = useExchangeRate()

  const { remainingValue, remainingDays } = useMemo(() => {
    if (loading || !node.expired_at) {
      return { remainingValue: 0, remainingDays: 0 }
    }

    const remaining = calculateRemainingValueWithConversion(
      node.price,
      node.currency,
      node.billing_cycle,
      node.expired_at,
      targetCurrency
    )

    const now = new Date()
    const expiredDate = new Date(node.expired_at)
    const days = Math.max(0, Math.ceil((expiredDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))

    return {
      remainingValue: remaining,
      remainingDays: days
    }
  }, [
    node.price,
    node.currency,
    node.billing_cycle,
    node.expired_at,
    targetCurrency,
    calculateRemainingValueWithConversion,
    loading
  ])

  const displayValue = useMemo(() => {
    if (loading) return '计算中...'
    if (remainingValue <= 0) return '无剩余价值'

    return formatCurrencyWithConversion(remainingValue, node.currency, targetCurrency, {
      showSymbol
    })
  }, [remainingValue, node.currency, targetCurrency, showSymbol, formatCurrencyWithConversion, loading])

  if (node.price === -1 || node.price === 0 || !node.expired_at) {
    return null
  }

  return (
    <div
      className={cn(
        'text-sm text-gray-600 dark:text-gray-400',
        loading && 'opacity-75',
        className
      )}
      title={
        isRatesAvailable && remainingValue > 0
          ? `剩余 ${remainingDays} 天，价值 ${displayValue}`
          : undefined
      }
      {...props}
    >
      剩余价值: {displayValue}
    </div>
  )
}

interface MonthlyRenewalDisplayProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** 价格 */
  price: number
  /** 原始货币 */
  currency: string
  /** 计费周期（天数） */
  billingCycle: number
  /** 自定义目标货币 */
  targetCurrency?: string
  /** 是否显示货币符号 */
  showSymbol?: boolean
  /** 额外的样式类名 */
  className?: string
}

export const MonthlyRenewalDisplay: React.FC<MonthlyRenewalDisplayProps> = ({
  price,
  currency,
  billingCycle,
  targetCurrency,
  showSymbol,
  className,
  ...props
}) => {
  const {
    calculateMonthlyRenewalWithConversion,
    formatCurrencyWithConversion,
    isRatesAvailable,
    loading
  } = useExchangeRate()

  const monthlyAmount = useMemo(() => {
    if (loading) return 0
    
    return calculateMonthlyRenewalWithConversion(
      price,
      currency,
      billingCycle,
      targetCurrency
    )
  }, [price, currency, billingCycle, targetCurrency, calculateMonthlyRenewalWithConversion, loading])

  const displayValue = useMemo(() => {
    if (loading) return '计算中...'
    if (monthlyAmount <= 0) return '0'

    return formatCurrencyWithConversion(monthlyAmount, currency, targetCurrency, {
      showSymbol
    })
  }, [monthlyAmount, currency, targetCurrency, showSymbol, formatCurrencyWithConversion, loading])

  if (price === -1 || price === 0 || billingCycle <= 0) {
    return null
  }

  return (
    <span
      className={cn(
        'inline-flex items-center',
        loading && 'opacity-75',
        className
      )}
      title={
        isRatesAvailable && monthlyAmount > 0
          ? `月续费: ${displayValue} (基于${billingCycle}天周期计算)`
          : undefined
      }
      {...props}
    >
      {displayValue}/月
    </span>
  )
}

// 组合组件：完整的价格信息显示
interface PriceInfoProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 节点数据 */
  node: NodeData
  /** 自定义目标货币 */
  targetCurrency?: string
  /** 是否显示货币符号 */
  showSymbol?: boolean
  /** 是否显示剩余价值 */
  showRemainingValue?: boolean
  /** 是否显示月续费 */
  showMonthlyRenewal?: boolean
  /** 额外的样式类名 */
  className?: string
}

export const PriceInfo: React.FC<PriceInfoProps> = ({
  node,
  targetCurrency,
  showSymbol,
  showRemainingValue = true,
  showMonthlyRenewal = true,
  className,
  ...props
}) => {
  if (node.price === -1) {
    return <span className={cn('text-green-500', className)}>免费</span>
  }

  if (node.price === 0 || !node.currency || !node.billing_cycle) {
    return null
  }

  return (
    <div className={cn('space-y-1', className)} {...props}>
      {/* 主要价格显示 */}
      <CurrencyDisplay
        price={node.price}
        currency={node.currency}
        billingCycle={node.billing_cycle}
        targetCurrency={targetCurrency}
        showSymbol={showSymbol}
        type="price"
        className="font-medium"
      />

      {/* 剩余价值 */}
      {showRemainingValue && (
        <RemainingValueDisplay
          node={node}
          targetCurrency={targetCurrency}
          showSymbol={showSymbol}
        />
      )}

      {/* 月续费 */}
      {showMonthlyRenewal && (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          月续费: {' '}
          <MonthlyRenewalDisplay
            price={node.price}
            currency={node.currency}
            billingCycle={node.billing_cycle}
            targetCurrency={targetCurrency}
            showSymbol={showSymbol}
          />
        </div>
      )}
    </div>
  )
}