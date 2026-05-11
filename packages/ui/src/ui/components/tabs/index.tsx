"use client";

import { type ReactNode, useState } from "react";

import { BEM } from "@/ui/utils/bem";

import styles from "./index.module.scss";

export interface TabItem {
  id: string;
  label: ReactNode;
  badge?: ReactNode;
}

interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  className?: string;
}

const b = BEM("tabs", styles);

export const Tabs = ({ items, value, defaultValue, onChange, className }: TabsProps) => {
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.id);
  const active = value ?? internal;

  return (
    <div className={b().extend({ className })} role="tablist">
      {items.map((item) => (
        <button
          key={item.id}
          role="tab"
          aria-selected={active === item.id}
          className={b("tab", { active: active === item.id }).toString()}
          onClick={() => {
            setInternal(item.id);
            onChange?.(item.id);
          }}
        >
          {item.label}
          {item.badge !== undefined && <span className={styles["tabs__badge"]}>{item.badge}</span>}
        </button>
      ))}
    </div>
  );
};
