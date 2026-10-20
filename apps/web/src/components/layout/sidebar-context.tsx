'use client';
import { createContext, useContext } from 'react';

interface SidebarContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const SidebarContext = createContext<SidebarContextValue>({ open: false, setOpen: () => undefined });

/** Lets any page Header open the mobile navigation drawer without prop drilling. */
export const useSidebar = () => useContext(SidebarContext);
