"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  Clock,
  GraduationCap,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CourseModule {
  module?: string;
  name?: string;
  topics?: string[];
}

interface CourseData {
  id: string;
  title: string;
  slug?: string;
  subtitle?: string;
  description?: string;
  category?: string;
  duration?: string;
  eligibility?: string;
  fee?: number | null;
  status?: string;
  curriculum?: CourseModule[];
  modules?: CourseModule[];
  batches?: Array<{ id: string; name?: string; startDate?: string }>;
}

export default function CourseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params?.id as string;

  const { data: course, isLoading, isError } = useQuery<CourseData>({
    queryKey: ["course", courseId],
    queryFn: async () => {
      const res = await fetch(`/api/v1/courses/${courseId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.data ?? json;
    },
    enabled: !!courseId,
  });

  const modulesList: CourseModule[] = React.useMemo(() => {
    if (!course) return [];
    if (Array.isArray(course.modules)) return course.modules;
    if (Array.isArray(course.curriculum)) return course.curriculum;
    return [];
  }, [course]);

  if (isLoading) {
    return (
      <div className="space-y-6 pb-12 animate-pulse">
        <div className="h-8 w-48 bg-white/5 rounded" />
        <div className="h-64 bg-white/5 rounded-xl border border-white/5" />
      </div>
    );
  }

  if (isError || !course) {
    return (
      <div className="space-y-6 pb-12">
        <Button variant="ghost" size="sm" onClick={() => router.push("/courses")} className="text-muted-foreground hover:text-white">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Courses
        </Button>
        <Card className="glass-panel border-red-500/20 bg-red-500/5 text-center p-8">
          <p className="text-sm text-red-400">Course could not be loaded or was not found.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.push("/courses")} className="text-muted-foreground hover:text-white">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Courses
        </Button>
        <Badge variant="outline" className="border-primary/40 text-primary">
          {course.status ?? "ACTIVE"}
        </Badge>
      </div>

      <div className="rounded-2xl border border-white/10 bg-secondary/20 p-6 md:p-8 backdrop-blur-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-mono text-primary uppercase tracking-widest mb-1">{course.category ?? "Aviation Academic Program"}</p>
            <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">{course.title}</h1>
            {course.subtitle && <p className="text-sm text-muted-foreground mt-1">{course.subtitle}</p>}
          </div>
          {course.fee != null && (
            <div className="text-left md:text-right">
              <span className="text-xs text-muted-foreground block">Tuition Fee</span>
              <span className="text-2xl font-extrabold text-emerald-400 font-mono">
                {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(course.fee)}
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-4 w-4 text-primary" />
            <span>Duration: {course.duration ?? "Standard"}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <GraduationCap className="h-4 w-4 text-primary" />
            <span>Eligibility: {course.eligibility ?? "10+2 / Equivalent"}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <BookOpen className="h-4 w-4 text-primary" />
            <span>Modules: {modulesList.length}</span>
          </div>
        </div>
      </div>

      {course.description && (
        <Card className="glass-panel border-white/10">
          <CardHeader>
            <CardTitle className="text-base text-white">Course Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{course.description}</p>
          </CardContent>
        </Card>
      )}

      <Card className="glass-panel border-white/10">
        <CardHeader>
          <CardTitle className="text-base text-white flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Curriculum &amp; Syllabus Modules
          </CardTitle>
          <CardDescription className="text-xs">Structured academic modules mapped to DGCA / airline standards</CardDescription>
        </CardHeader>
        <CardContent>
          {modulesList.length > 0 ? (
            <div className="space-y-4">
              {modulesList.map((mod, i) => (
                <div key={i} className="p-4 rounded-xl bg-secondary/30 border border-white/5 space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono font-bold bg-secondary px-2 py-1 rounded text-primary">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h4 className="text-sm font-semibold text-white">{mod.module || mod.name || `Module ${i + 1}`}</h4>
                  </div>
                  {Array.isArray(mod.topics) && mod.topics.length > 0 && (
                    <ul className="pl-8 space-y-1 text-xs text-muted-foreground list-disc">
                      {mod.topics.map((t, ti) => (
                        <li key={ti}>{t}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-6 text-center">No syllabus modules defined for this course.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
