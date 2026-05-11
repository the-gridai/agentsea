import { memo, type ReactNode } from "react";

import { Text } from "@/ui/components/text";

import styles from "./index.module.scss";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export const EmptyState = memo(function EmptyStateComp({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={`${styles["empty"]} ${className ?? ""}`.trim()}>
      {icon && <div className={styles["empty__icon"]}>{icon}</div>}
      <Text type="header-3" weight="bold">
        {title}
      </Text>
      {description && (
        <Text type="text-m" color="neutral" className={styles["empty__desc"]}>
          {description}
        </Text>
      )}
      {action && <div className={styles["empty__action"]}>{action}</div>}
    </div>
  );
});
