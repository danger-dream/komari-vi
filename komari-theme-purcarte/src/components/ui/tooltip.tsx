import { useCallback } from "react";

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: any;
  chartConfig?: any;
  labelFormatter?: (label: any) => string;
}

export const CustomTooltip = ({
  active,
  payload,
  label,
  chartConfig,
  labelFormatter,
}: CustomTooltipProps) => {
  const defaultLabelFormatter = useCallback((value: any) => {
    const date = new Date(value);
    return date.toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, []);

  if (active && payload && payload.length) {
    return (
      <div className="bg-background/80 p-3 theme-card-style max-w-xs">
        <p className="text-xs font-medium text-muted-foreground mb-2">
          {labelFormatter
            ? labelFormatter(label)
            : defaultLabelFormatter(label)}
        </p>
        <div className="space-y-1">
          {payload.map((item: any, index: number) => {
            const series = chartConfig?.series
              ? chartConfig.series.find((s: any) => s.dataKey === item.dataKey)
              : {
                  dataKey: chartConfig?.dataKey || item.dataKey,
                  tooltipLabel: chartConfig?.tooltipLabel || item.name,
                  tooltipFormatter: chartConfig?.tooltipFormatter,
                };

            let value = item.value;
            if (series?.tooltipFormatter) {
              value = series.tooltipFormatter(value, item.payload);
            } else if (typeof value === "number") {
              value = `${value.toFixed(0)}`;
            } else {
              value = value?.toString() || "-";
            }

            return (
              <div
                key={`${item.dataKey}-${index}`}
                className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-sm font-medium text-foreground">
                    {series?.tooltipLabel || item.name || item.dataKey}:
                  </span>
                </div>
                <span className="text-sm font-bold ml-2">{value}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return null;
};
