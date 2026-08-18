import React from "react";
import { Skeleton } from './ui/skeleton';

export function DashboardLayoutSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      {/* Mobile top bar skeleton */}
      <div className="flex h-14 items-center justify-between border-b border-border px-4 lg:hidden">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded-md" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>

      {/* Desktop sidebar skeleton */}
      <div className="relative hidden w-[264px] border-r border-border bg-background p-4 pb-24 lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:flex-col lg:gap-6">
        {/* Logo area */}
        <div className="flex items-center gap-3 px-2">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-4 w-24" />
        </div>

        {/* Menu items */}
        <div className="space-y-2 px-2">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>

        {/* User profile area at bottom */}
        <div className="absolute bottom-4 left-4 right-4">
          <div className="flex items-center gap-3 px-1">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-2 w-32" />
            </div>
          </div>
        </div>
      </div>

      {/* Main content skeleton */}
      <div className="min-h-screen p-4 pb-24 lg:pb-10 lg:pl-[264px]">
        <div className="space-y-4">
          <Skeleton className="h-12 w-48 rounded-lg" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>

      {/* Mobile bottom tab bar skeleton */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-3 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-md lg:hidden">
        <div className="mx-auto grid max-w-xl grid-cols-5 gap-1">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex flex-col items-center gap-1 px-2 py-1.5">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-2 w-8 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
