import React, { useState } from 'react';

interface CollapsibleTableSectionProps {
  title: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  defaultCollapsed?: boolean;
  className?: string;
  bodyClassName?: string;
  padded?: boolean;
}

const CollapsibleTableSection: React.FC<CollapsibleTableSectionProps> = ({
  title,
  children,
  actions,
  defaultCollapsed = false,
  className = '',
  bodyClassName = 'overflow-x-auto',
  padded = false,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <section className={`overflow-hidden rounded-lg bg-white shadow-md transition-shadow duration-200 ease-out hover:shadow-lg ${className}`}>
      <div className="flex items-center justify-between gap-3 bg-[#003F72] px-5 py-4 text-white">
        <h2 className="min-w-0 truncate text-xl font-semibold">{title}</h2>
        <div className="flex shrink-0 items-center gap-3">
          {actions}
          <button
            type="button"
            onClick={() => setIsCollapsed((value) => !value)}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-white/25 bg-white/10 text-lg font-bold leading-none transition hover:bg-white/20"
            aria-label={isCollapsed ? 'Expand table' : 'Collapse table'}
            title={isCollapsed ? 'Expand table' : 'Collapse table'}
          >
            <span className={`transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}>
              &gt;
            </span>
          </button>
        </div>
      </div>
      {!isCollapsed && (
        <div className={`${bodyClassName} ${padded ? 'p-6' : ''}`}>
          {children}
        </div>
      )}
    </section>
  );
};

export default CollapsibleTableSection;
