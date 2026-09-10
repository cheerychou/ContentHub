import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MagnifyingGlass, ArrowCounterClockwise } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// （自 CDD3 shared-ui 移植，2026-09-10：cn 改 @/lib/utils；Select 用本仓 ui/select；
//  去掉 dateRange 字段类型——本仓无 DateRangeInput，且当前用法仅需 input）

export interface SearchFormField {
  name: string;
  label: string;
  type: 'input' | 'select' | 'datePicker';
  placeholder?: string;
  options?: { label: string; value: string }[];
  required?: boolean;
  rules?: {
    pattern?: RegExp;
    minLength?: number;
    maxLength?: number;
    message?: string;
  };
}

export type SearchFormValues = Record<string, unknown>;

export interface SearchFormProps {
  fields: SearchFormField[];
  values: SearchFormValues;
  onChange: (values: SearchFormValues) => void;
  onSearch: () => void;
  onReset: () => void;
  layout?: 'grid' | 'inline';
  className?: string;
  validateOnSearch?: boolean;
  loading?: boolean;
}

/**
 * 通用搜索表单组件
 * 支持多字段拆分搜索、四列栅格布局、校验
 * 统一标签和输入框之间的间距
 * 动态操作按钮位置
 * @param fields - 搜索字段配置
 * @param values - 集中管理的搜索值
 * @param onChange - 值变更回调
 * @param onSearch - 查询回调
 * @param onReset - 重置回调
 * @param layout - 布局模式
 * @param className - 容器类名
 * @param validateOnSearch - 是否在搜索时校验
 * @param loading - 加载状态，禁用查询按钮
 */
export function SearchForm({
  fields,
  values,
  onChange,
  onSearch,
  onReset,
  layout = 'grid',
  className,
  validateOnSearch = false,
  loading = false,
}: SearchFormProps) {
  const idPrefix = React.useId();
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const validateField = (field: SearchFormField, value: unknown): string | null => {
    if (field.required && !value) {
      return `${field.label}不能为空`;
    }
    if (field.rules) {
      const { pattern, minLength, maxLength, message } = field.rules;
      if (pattern && value && !pattern.test(String(value))) {
        return message || `${field.label}格式不正确`;
      }
      if (minLength && value && String(value).length < minLength) {
        return message || `${field.label}至少需要${minLength}个字符`;
      }
      if (maxLength && value && String(value).length > maxLength) {
        return message || `${field.label}最多${maxLength}个字符`;
      }
    }
    return null;
  };

  const validateAll = (): boolean => {
    const newErrors: Record<string, string> = {};
    let isValid = true;

    fields.forEach((field) => {
      const value = values[field.name];
      const error = validateField(field, value);
      if (error) {
        newErrors[field.name] = error;
        isValid = false;
      }
    });

    setErrors(newErrors);
    return isValid;
  };

  const handleSearch = () => {
    if (validateOnSearch) {
      const isValid = validateAll();
      if (!isValid) return;
    }
    onSearch();
  };

  const handleChange = (name: string, value: unknown) => {
    const newValues = { ...values, [name]: value };
    onChange(newValues);

    if (errors[name]) {
      const newErrors = { ...errors };
      delete newErrors[name];
      setErrors(newErrors);
    }
  };

  const renderField = (field: SearchFormField, showLabel: boolean = true) => {
    const { name, type, placeholder, options, label } = field;
    const value = values[name] ?? '';
    const error = errors[name];
    const fieldId = `${idPrefix}-${name}`;

    const fieldWrapper = (children: React.ReactNode) => (
      <div className="flex flex-col gap-3">
        {showLabel && label && (
          <label htmlFor={fieldId} className="text-xs font-medium leading-none text-muted-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            {label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </label>
        )}
        {children}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    );

    switch (type) {
      case 'input': {
        return fieldWrapper(
          <Input
            id={fieldId}
            placeholder={placeholder}
            value={String(value ?? '')}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange(name, e.target.value)}
            className={cn(error && 'border-destructive focus-visible:ring-destructive')}
          />
        );
      }

      case 'select': {
        return fieldWrapper(
          <Select
            value={String(value ?? '')}
            onValueChange={(val) => handleChange(name, val)}
          >
            <SelectTrigger
              className={cn(error && 'border-destructive focus:ring-destructive')}
              aria-label={label}
            >
              <SelectValue placeholder={placeholder || `请选择${label}`} />
            </SelectTrigger>
            <SelectContent>
              {options?.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      case 'datePicker': {
        return fieldWrapper(
          <Input
            id={fieldId}
            type="date"
            placeholder={placeholder}
            value={String(value ?? '')}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange(name, e.target.value)}
            className={cn(error && 'border-destructive focus-visible:ring-destructive')}
          />
        );
      }

      default:
        return null;
    }
  };

  if (layout === 'inline') {
    return (
      <div className={cn('flex items-end gap-4', className)}>
        {fields.map((field) => {
          const inlineFieldId = `${idPrefix}-${field.name}`;
          return (
          <div key={field.name} className="flex flex-col gap-1 min-w-[150px]">
            {field.label && (
              <label htmlFor={inlineFieldId} className="text-sm text-muted-foreground whitespace-nowrap">
                {field.label}
                {field.required && <span className="text-destructive ml-1">*</span>}
              </label>
            )}
            <div className="flex-1">
              {renderField(field, false)}
            </div>
            {errors[field.name] && (
              <span className="text-xs text-destructive">{errors[field.name]}</span>
            )}
          </div>
        );
        })}
        <div className="flex items-center gap-2">
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleSearch}
            disabled={loading}
          >
            <MagnifyingGlass className="h-4 w-4" />
            查询
          </Button>
          <Button
            variant="outline"
            className="bg-background text-foreground hover:bg-muted border-input"
            onClick={() => {
              setErrors({});
              onReset();
            }}
          >
            <ArrowCounterClockwise className="h-4 w-4" />
            重置
          </Button>
        </div>
      </div>
    );
  }

  const gridColumns = `grid-cols-1 md:grid-cols-2 lg:grid-cols-4`;

  const count = fields.length;

  const displayItems: React.ReactNode[] = fields.map((field) => (
    <div key={field.name}>
      {field.label ? renderField(field) : <div />}
    </div>
  ));

  const actionButtons = (
    <div key="actions" className="flex items-end justify-end gap-2">
      <Button
        className="bg-primary text-primary-foreground hover:bg-primary/90"
        onClick={handleSearch}
        disabled={loading}
      >
        <MagnifyingGlass className="h-4 w-4" />
        查询
      </Button>
      <Button
        variant="outline"
        className="bg-background text-foreground hover:bg-muted border-input"
        onClick={() => {
          setErrors({});
          onReset();
        }}
      >
        <ArrowCounterClockwise className="h-4 w-4" />
        重置
      </Button>
    </div>
  );

  if (count <= 3) {
    displayItems.push(actionButtons);
  } else if (count <= 7) {
    while (displayItems.length < 7) {
      displayItems.push(<div key={`spacer-${displayItems.length}`} />);
    }
    displayItems.push(actionButtons);
  } else {
    while (displayItems.length < 11) {
      displayItems.push(<div key={`spacer-${displayItems.length}`} />);
    }
    displayItems.push(actionButtons);
  }

  return (
    <div className={cn('grid gap-6', gridColumns, className)}>
      {displayItems}
    </div>
  );
}
