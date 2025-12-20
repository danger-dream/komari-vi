import { getProgressBarClass } from "@/utils";

export const ProgressBar = ({
  value,
  h = "h-3",
  className,
}: {
  value: number;
  h?: string;
  className?: string;
}) => {
  const clampedValue = Math.max(0, Math.min(100, value));
  const progressRoundedClass =
    clampedValue < 10 ? "rounded-sm" : "rounded-full";

  return (
    <div
      className={`w-full bg-(--accent-4)/50 rounded-full ${h} overflow-hidden`}>
      <div
        className={`${h} ${progressRoundedClass} transition-all duration-500 ${getProgressBarClass(
          clampedValue
        )} ${className}`}
        style={{ width: `${clampedValue}%` }}></div>
    </div>
  );
};
