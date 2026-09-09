import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { Check, CaretDown, CaretUp } from "@phosphor-icons/react";
import { cn } from "@/lib/utils"

// Base UI Select 原语映射（对外导出名与 radix 版保持一致，业务零改动）：
// Content = Positioner + Popup；Viewport = List；Label = GroupLabel；
// ScrollUp/DownButton = ScrollUpArrow/ScrollDownArrow；
// --radix-select-trigger-width → --anchor-width。

// Root 薄包装：Base UI 的 onValueChange 为 (value | null, eventDetails) 双参，
// 此处窄化回 radix 兼容签名 (value)（项目无 clearable 用法，null 不出现）。
// 额外支持 onChange 别名：统一映射到 onValueChange，便于 FormField（children 版）
// 统一注入 onChange，而无需感知子组件是 Input 还是 Select。
function Select({
  value,
  defaultValue,
  onValueChange,
  onChange,
  ...props
}: Omit<SelectPrimitive.Root.Props<unknown>, "onValueChange" | "value" | "defaultValue"> & {
    value?: unknown
    defaultValue?: unknown
    onValueChange?: (value: any) => void
    /** 兼容 FormField 注入的 onChange（与 onValueChange 等价，二选一） */
    onChange?: (value: any) => void
  }) {
  const handleChange = onValueChange ?? onChange
  return (
    <SelectPrimitive.Root
      value={value as any}
      defaultValue={defaultValue as any}
      onValueChange={
        handleChange
          ? (v) => handleChange(v as any)
          : undefined
      }
      {...props}
    />
  )
}

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon render={<CaretDown className="h-4 w-4 opacity-50" />} />
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = "SelectTrigger"

const SelectScrollUpButton = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpArrow
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <CaretUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpArrow>
))
SelectScrollUpButton.displayName = "SelectScrollUpButton"

const SelectScrollDownButton = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownArrow
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <CaretDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownArrow>
))
SelectScrollDownButton.displayName = "SelectScrollDownButton"

const SelectContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof SelectPrimitive.Popup> &
    Pick<
      React.ComponentProps<typeof SelectPrimitive.Positioner>,
      "align" | "alignOffset" | "side" | "sideOffset"
    > & {
      /** radix 兼容 prop：Base UI 仅支持 popper 定位，item-aligned 模式不再提供 */
      position?: "popper" | "item-aligned"
    }
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Positioner
      side="bottom"
      sideOffset={4}
      align={props.align}
      alignOffset={props.alignOffset}
      className="isolate z-50"
    >
      <SelectPrimitive.Popup
        ref={ref}
        data-slot="select-content"
        className={cn(
          "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          "w-(--anchor-width)",
          className
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.List className="p-1">
          {children}
        </SelectPrimitive.List>
        <SelectScrollDownButton />
      </SelectPrimitive.Popup>
    </SelectPrimitive.Positioner>
  </SelectPrimitive.Portal>
))
SelectContent.displayName = "SelectContent"

const SelectLabel = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof SelectPrimitive.GroupLabel>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.GroupLabel
    ref={ref}
    className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = "SelectLabel"

const SelectItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>

    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = "SelectItem"

const SelectSeparator = React.forwardRef<
  HTMLHRElement,
  React.ComponentProps<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = "SelectSeparator"

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
