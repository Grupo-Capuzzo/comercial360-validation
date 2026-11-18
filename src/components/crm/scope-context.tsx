"use client";
import { createContext, useContext } from "react";
const Scope = createContext("geral");
export const CrmScopeContextProvider = Scope.Provider;
export function useCrmScope() { return useContext(Scope); }
