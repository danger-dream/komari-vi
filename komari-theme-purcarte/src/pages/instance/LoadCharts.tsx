import { memo, useRef } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { NodeData, NodeStats } from "@/types/node";
import { formatBytes } from "@/utils";
import { Flex } from "@radix-ui/themes";
import Loading from "@/components/loading";
import { useLoadCharts } from "@/hooks/useLoadCharts";
import { CustomTooltip } from "@/components/ui/tooltip";
import { lableFormatter, loadChartTimeFormatter } from "@/utils/chartHelper";

interface LoadChartsProps {
  node: NodeData;
  hours: number;
  liveData?: NodeStats;
}

const LoadCharts = memo(({ node, hours, liveData }: LoadChartsProps) => {
  const { loading, error, chartData, memoryChartData } = useLoadCharts(
    node,
    hours
  );

  const chartDataLengthRef = useRef(0);
  chartDataLengthRef.current = chartData.length;

  // 样式和颜色
  const cn = "flex flex-col w-full overflow-hidden";
  const chartMargin = { top: 8, right: 16, bottom: 8, left: 16 };
  const colors = ["#F38181", "#FCE38A", "#EAFFD0", "#95E1D3"];

  // 图表配置
  const chartConfigs = [
    {
      id: "cpu",
      title: "CPU",
      type: "area",
      value: liveData?.cpu?.usage ? `${liveData.cpu.usage.toFixed(2)}%` : "-",
      dataKey: "cpu",
      yAxisDomain: [0, 100],
      yAxisFormatter: (value: number, index: number) =>
        index !== 0 ? `${value}%` : "",
      color: colors[0],
      data: chartData,
      tooltipFormatter: (value: number) => `${value.toFixed(2)}%`,
      tooltipLabel: "CPU 使用率",
    },
    {
      id: "memory",
      title: "内存",
      type: "area",
      value: (
        <Flex gap="0" direction="column" align="end">
          <label>
            {liveData?.ram?.used
              ? `${formatBytes(liveData.ram.used)} / ${formatBytes(
                  node?.mem_total || 0
                )}`
              : "N/A"}
          </label>
          <label>
            {liveData?.swap?.used
              ? `${formatBytes(liveData.swap.used)} / ${formatBytes(
                  node?.swap_total || 0
                )}`
              : "N/A"}
          </label>
        </Flex>
      ),
      series: [
        {
          dataKey: "ram",
          color: colors[0],
          tooltipLabel: "内存",
          tooltipFormatter: (value: number, raw: any) =>
            `${formatBytes(raw?.ram_raw || 0)} (${value.toFixed(0)}%)`,
        },
        {
          dataKey: "swap",
          color: colors[1],
          tooltipLabel: "交换",
          tooltipFormatter: (value: number, raw: any) =>
            `${formatBytes(raw?.swap_raw || 0)} (${value.toFixed(0)}%)`,
        },
      ],
      yAxisDomain: [0, 100],
      yAxisFormatter: (value: number, index: number) =>
        index !== 0 ? `${value}%` : "",
      data: memoryChartData,
    },
    {
      id: "disk",
      title: "磁盘",
      type: "area",
      value: liveData?.disk?.used
        ? `${formatBytes(liveData.disk.used)} / ${formatBytes(
            node?.disk_total || 0
          )}`
        : "-",
      dataKey: "disk",
      yAxisDomain: [0, node?.disk_total || 100],
      yAxisFormatter: (value: number, index: number) =>
        index !== 0 ? formatBytes(value) : "",
      color: colors[0],
      data: chartData,
      tooltipFormatter: (value: number) => formatBytes(value),
      tooltipLabel: "磁盘使用",
    },
    {
      id: "network",
      title: "网络",
      type: "line",
      value: (
        <>
          <Flex gap="0" align="end" direction="column">
            <span>↑ {formatBytes(liveData?.network.up || 0)}/s</span>
            <span>↓ {formatBytes(liveData?.network.down || 0)}/s</span>
          </Flex>
        </>
      ),
      series: [
        {
          dataKey: "net_in",
          color: colors[0],
          tooltipLabel: "下载",
          tooltipFormatter: (value: number) => `${formatBytes(value)}/s`,
        },
        {
          dataKey: "net_out",
          color: colors[3],
          tooltipLabel: "上传",
          tooltipFormatter: (value: number) => `${formatBytes(value)}/s`,
        },
      ],
      yAxisFormatter: (value: number, index: number) =>
        index !== 0 ? formatBytes(value) : "",
      data: chartData,
    },
    {
      id: "connections",
      title: "连接数",
      type: "line",
      value: (
        <Flex gap="0" align="end" direction="column">
          <span>TCP: {liveData?.connections.tcp}</span>
          <span>UDP: {liveData?.connections.udp}</span>
        </Flex>
      ),
      series: [
        {
          dataKey: "connections",
          color: colors[0],
          tooltipLabel: "TCP 连接",
        },
        {
          dataKey: "connections_udp",
          color: colors[1],
          tooltipLabel: "UDP 连接",
        },
      ],
      yAxisFormatter: (value: number, index: number) =>
        index !== 0 ? `${value}` : "",
      data: chartData,
    },
    {
      id: "process",
      title: "进程数",
      type: "line",
      value: liveData?.process || "-",
      dataKey: "process",
      color: colors[0],
      yAxisFormatter: (value: number, index: number) =>
        index !== 0 ? `${value}` : "",
      data: chartData,
      tooltipLabel: "进程数",
    },
  ];

  // 根据配置渲染图表
  const renderChart = (config: any) => {
    const ChartComponent = config.type === "area" ? AreaChart : LineChart;
    const DataComponent =
      config.type === "area" ? Area : (Line as React.ComponentType<any>);

    // 只指定高度，让宽度自适应
    const chartProps = {
      height: 140, // 更小的高度以确保完全适应容器
      style: { overflow: "visible" }, // 通过内联样式解决Safari溢出问题
    };

    const chartConfig = config.series
      ? config.series.reduce((acc: any, series: any) => {
          acc[series.dataKey] = {
            label: series.tooltipLabel || series.dataKey,
            color: series.color,
          };
          return acc;
        }, {})
      : {
          [config.dataKey]: {
            label: config.tooltipLabel || config.dataKey,
            color: config.color,
          },
        };

    return (
      <Card className={cn} key={config.id} style={{ height: "220px" }}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 h-[80px]">
          <CardTitle className="text-sm font-medium">{config.title}</CardTitle>
          <div className="text-sm font-bold min-h-[20px] flex items-center">
            {config.value}
          </div>
        </CardHeader>
        <div
          className="h-[150px] w-full px-2 pb-2 align-bottom"
          style={{ minHeight: 0 }}>
          <ChartContainer config={chartConfig} className="h-full w-full">
            <ChartComponent
              data={config.data}
              margin={chartMargin}
              {...chartProps}>
              <CartesianGrid
                strokeDasharray="2 4"
                stroke="var(--theme-line-muted-color)"
                vertical={false}
              />
              <XAxis
                dataKey="time"
                tickLine={false}
                axisLine={{
                  stroke: "var(--theme-text-muted-color)",
                }}
                tick={{
                  fill: "var(--theme-text-muted-color)",
                }}
                tickFormatter={(value, index) =>
                  loadChartTimeFormatter(
                    value,
                    index,
                    chartDataLengthRef.current
                  )
                }
                interval={0}
                height={20}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                domain={config.yAxisDomain}
                tickFormatter={config.yAxisFormatter}
                orientation="left"
                type="number"
                tick={{
                  dx: -8,
                  fill: "var(--theme-text-muted-color)",
                }}
                width={200}
                mirror={true}
              />
              <Tooltip
                cursor={false}
                content={(props: any) => (
                  <CustomTooltip
                    {...props}
                    chartConfig={config}
                    labelFormatter={(value) => lableFormatter(value, hours)}
                  />
                )}
              />
              {config.series ? (
                config.series.map((series: any) => (
                  <DataComponent
                    key={series.dataKey}
                    dataKey={series.dataKey}
                    animationDuration={0}
                    stroke={series.color}
                    fill={config.type === "area" ? series.color : undefined}
                    opacity={0.8}
                    dot={false}
                  />
                ))
              ) : (
                <DataComponent
                  dataKey={config.dataKey}
                  animationDuration={0}
                  stroke={config.color}
                  fill={config.type === "area" ? config.color : undefined}
                  opacity={0.8}
                  dot={false}
                />
              )}
            </ChartComponent>
          </ChartContainer>
        </div>
      </Card>
    );
  };

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center purcarte-blur rounded-lg z-10">
          <Loading text="正在加载图表数据..." />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center purcarte-blur rounded-lg z-10">
          <p className="text-red-500">{error}</p>
        </div>
      )}
      <div
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
        style={{ minHeight: 0, overflow: "hidden" }}>
        {chartConfigs.map(renderChart)}
      </div>
    </div>
  );
});

export default LoadCharts;
