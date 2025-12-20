import React from "react";

interface CircleProgressProps {
  value: number;
  maxValue?: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  showPercentage?: boolean;
  color?: string;
}

export const CircleProgress: React.FC<CircleProgressProps> = ({
  value,
  maxValue = 100,
  size = 40,
  strokeWidth = 4,
  className = "",
  showPercentage = true,
  color = "",
}) => {
  const percentage = Math.min(100, Math.max(0, (value / maxValue) * 100));
  const radius = size / 2 - strokeWidth / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  const getColor = () => {
    if (color) return color;
    if (percentage > 90) return "stroke-red-600";
    if (percentage > 50) return "stroke-yellow-400";
    return "stroke-green-500";
  };

  return (
    <div className={`relative inline-flex ${className}`}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="stroke-(--accent-4)/50"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className={getColor()}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      {showPercentage && (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-medium">
          {percentage.toFixed(0)}%
        </div>
      )}
    </div>
  );
};
