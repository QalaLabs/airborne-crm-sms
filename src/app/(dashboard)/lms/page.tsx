"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BookOpen, Plus, ChevronRight, Trash2 } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { apiFetch } from "@/lib/api";
import { isOverviewOnly } from "@/lib/lms/course-overview";
import { CourseOverviewDetails } from "@/components/lms/course-overview-card";

interface LmsCourseRow {
  id: string;
  title: string;
  slug: string;
  isPublished: boolean;
  status: string;
  createdAt: string;
  description?: string | null;
  metadata?: unknown;
  _count?: { enrollments: number; stages: number };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export default function LmsCoursesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [slug, setSlug] = React.useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["lms-courses"],
    queryFn: () => apiFetch<LmsCourseRow[]>("/lms/courses"),
  });

  const createMutation = useMutation({
    mutationFn: (body: { title: string; slug: string }) =>
      apiFetch<LmsCourseRow>("/lms/courses", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      toast({ title: "LMS course created" });
      setOpen(false);
      setTitle("");
      setSlug("");
      await queryClient.invalidateQueries({ queryKey: ["lms-courses"] });
    },
    onError: (err: Error) => {
      toast({ title: "Create failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/lms/courses/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "LMS course deleted" });
      void queryClient.invalidateQueries({ queryKey: ["lms-courses"] });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const handleDeleteCourse = (id: string) => {
    if (confirm("Are you sure you want to permanently delete this LMS course? All stages, modules, timetable slots, assignments, and certificates will be cascade-deleted. THIS CANNOT BE UNDONE.")) {
      deleteMutation.mutate(id);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="LMS Courses"
        description="Student Management curriculum (Stage → Module → Chapter → Topic). Separate from website Course CMS."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New LMS Course
          </Button>
        }
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {isError && (
        <div className="rounded-lg border border-destructive/40 p-4 text-sm">
          Failed to load LMS courses.{" "}
          <button type="button" className="underline" onClick={() => void refetch()}>
            Retry
          </button>
        </div>
      )}

      <div className="grid gap-3">
        {(data ?? []).map((course) => isOverviewOnly(course) ? (
          <div
            key={course.id}
            data-testid="lms-course-overview"
            className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card/60 px-4 py-3"
          >
            <CourseOverviewDetails title={course.title} description={course.description} metadata={course.metadata} />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleDeleteCourse(course.id)}
              disabled={deleteMutation.isPending}
              className="h-8 w-8 shrink-0 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-transparent"
              title="Delete course"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Link
            key={course.id}
            href={`/lms/courses/${course.id}`}
            className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-4 py-3 hover:bg-card/80 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15">
                <BookOpen className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{course.title}</p>
                <p className="text-xs text-muted-foreground">
                  /{course.slug} · {course._count?.stages ?? 0} stages · {course._count?.enrollments ?? 0} enrolled
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold uppercase tracking-wide ${course.isPublished ? "text-emerald-400" : "text-muted-foreground"}`}>
                {course.isPublished ? "Published" : course.status}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDeleteCourse(course.id);
                }}
                disabled={deleteMutation.isPending}
                className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-transparent"
                title="Delete course"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground" />
            </div>
          </Link>
        ))}
        {!isLoading && (data?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">No LMS courses yet. Create the first curriculum track.</p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create LMS Course</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setSlug(slugify(e.target.value));
              }}
            />
            <Input placeholder="slug" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!title || !slug || createMutation.isPending}
              onClick={() => createMutation.mutate({ title, slug })}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PortalAccessPanel />
    </div>
  );
}

function PortalAccessPanel() {
  const [studentId, setStudentId] = React.useState("");
  const [password, setPassword] = React.useState("");
  const provision = useMutation({
    mutationFn: () =>
      apiFetch("/lms/portal-access", {
        method: "POST",
        body: JSON.stringify({ studentId, password }),
      }),
    onSuccess: () => toast({ title: "Portal access provisioned - student can sign in" }),
    onError: (err: Error) => toast({ title: "Provision failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="mt-8 rounded-xl border border-border bg-card/60 p-4">
      <h2 className="text-sm font-semibold text-white">Provision student portal login</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Creates a STUDENT user (or links existing) to CRM Student.userId.
      </p>
      <div className="grid gap-2 md:grid-cols-3">
        <Input placeholder="Student UUID" value={studentId} onChange={(e) => setStudentId(e.target.value)} />
        <Input
          type="password"
          placeholder="Temp password (min 8)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button
          disabled={!studentId || password.length < 8 || provision.isPending}
          onClick={() => provision.mutate()}
        >
          Provision access
        </Button>
      </div>
    </div>
  );
}
