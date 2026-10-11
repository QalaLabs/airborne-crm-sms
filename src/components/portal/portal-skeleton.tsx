import { cn } from "@/lib/utils";



export function TextSkeleton({ className }: { className?: string }) {

  return (

    <div

      className={cn(

        "animate-pulse rounded-md bg-white/[0.05]",

        className,

      )}

      aria-hidden="true"

    />

  );

}



export function CardSkeleton({ className }: { className?: string }) {

  return (

    <div

      className={cn(

        "ab-glass-soft animate-pulse space-y-3 p-5",

        className,

      )}

      aria-hidden="true"

    >

      <div className="h-3 w-1/3 rounded bg-white/[0.05]" />

      <div className="h-8 w-1/2 rounded bg-white/[0.05]" />

      <div className="h-2 w-full rounded bg-white/[0.04]" />

    </div>

  );

}



export function DashboardSkeleton() {

  return (

    <div className="space-y-8" aria-busy="true" aria-label="Loading dashboard…">

      <div className="space-y-3">

        <TextSkeleton className="h-3 w-24" />

        <TextSkeleton className="h-10 w-64" />

        <TextSkeleton className="h-4 w-80 max-w-full" />

      </div>

      <CardSkeleton className="h-36" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">

        {[0, 1, 2, 3].map((i) => (

          <CardSkeleton key={i} className="h-28" />

        ))}

      </div>

      <div className="grid gap-4 lg:grid-cols-2">

        <CardSkeleton className="h-48" />

        <CardSkeleton className="h-48" />

      </div>

    </div>

  );

}



export function PlayerSkeleton() {

  return (

    <div className="flex gap-4" aria-busy="true" aria-label="Loading course player…">

      <div className="hidden w-72 shrink-0 space-y-3 lg:block">

        <CardSkeleton className="h-[70vh]" />

      </div>

      <div className="min-w-0 flex-1 space-y-4">

        <TextSkeleton className="h-6 w-2/3" />

        <CardSkeleton className="h-[50vh]" />

        <div className="flex gap-2">

          <TextSkeleton className="h-10 w-24" />

          <TextSkeleton className="h-10 w-24" />

        </div>

      </div>

    </div>

  );

}



export function CoursesListSkeleton() {

  return (

    <div className="space-y-6" aria-busy="true" aria-label="Loading courses…">

      <TextSkeleton className="h-8 w-48" />

      <div className="grid gap-4 sm:grid-cols-2">

        {[0, 1, 2, 3].map((i) => (

          <CardSkeleton key={i} className="h-40" />

        ))}

      </div>

    </div>

  );

}


