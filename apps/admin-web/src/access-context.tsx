import { createContext, useContext } from "react";
import { Button, type ButtonProps } from "antd";
import type { AccessSnapshot } from "./api.ts";
export const AccessContext = createContext<AccessSnapshot | null>(null);
export function useCan() {
  const access = useContext(AccessContext);
  return (permission: string) => access === null || access.isSuperAdmin || access.permissions.includes(permission);
}
export function PermissionButton({ permission, ...props }: ButtonProps & {permission?: string}) {
  const can = useCan();
  return permission && !can(permission) ? null : <Button {...props} />;
}
