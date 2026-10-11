"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MapPin, Briefcase, Clock, Users, MoreHorizontal } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/shared/data-table";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { jobApplicationStatusValues } from "@/lib/validations/job.schema";
import { toast } from "@/components/ui/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface Job {
  id: string;
  title: string;
  slug: string;
  description?: string;
  requirements?: string;
  status: string;
  jobType?: string;
  location?: string;
  salaryMin?: number;
  salaryMax?: number;
  hiringPartner?: { name: string; logoId?: string | null };
  publishedAt?: string | null;
  closesAt?: string | null;
  createdAt: string;
}

interface JobApplication {
  id: string;
  applicantName: string;
  applicantEmail: string;
  applicantPhone?: string;
  status: string;
  resumeUrl?: string;
  createdAt: string;
}

interface ApplicationsResponse {
  data: JobApplication[];
  total: number;
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: job, isLoading: jobLoading } = useQuery({
    queryKey: ["job", id],
    queryFn: () => apiFetch<Job>(`/jobs/${id}`),
    enabled: !!id,
  });

  const logoId = job?.hiringPartner?.logoId ?? null;
  const { data: logoAsset } = useQuery({
    queryKey: ["media", logoId],
    queryFn: () => apiFetch<{ fileUrl: string; altText?: string | null }>(`/media/${logoId}`),
    enabled: !!logoId,
  });

  const { data: applications, isLoading: appsLoading } = useQuery({
    queryKey: ["job-applications", id],
    queryFn: () => apiFetch<ApplicationsResponse>(`/job-applications?jobId=${id}&page=1&limit=50`),
    enabled: !!id,
  });

  const applicationColumns: ColumnDef<JobApplication>[] = [
    {
      accessorKey: "applicantName",
      header: "Applicant",
      cell: ({ row }) => (
        <div>
          <p className="text-sm font-medium text-foreground">{row.original.applicantName}</p>
          <p className="text-xs text-muted-foreground">{row.original.applicantEmail}</p>
        </div>
      ),
    },
    {
      accessorKey: "applicantPhone",
      header: "Phone",
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.applicantPhone ?? "-"}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} domain="job_application" />,
    },
    {
      accessorKey: "createdAt",
      header: "Applied",
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDate(row.original.createdAt)}</span>,
    },
    {
      id: "actions",
      size: 50,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {jobApplicationStatusValues.map((status) => (
              <DropdownMenuItem
                key={status}
                onClick={() =>
                  apiFetch(`/job-applications/${row.original.id}/status`, {
                    method: "PATCH",
                    body: JSON.stringify({ status }),
                  })
                    .then(() => queryClient.invalidateQueries({ queryKey: ["job-applications", id] }))
                    .catch((err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }))
                }
              >
                Mark as {status.replace(/_/g, " ")}
              </DropdownMenuItem>
            ))}
            {row.original.resumeUrl && (
              <DropdownMenuItem asChild>
                <a href={row.original.resumeUrl} target="_blank" rel="noreferrer">View Resume</a>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  if (jobLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!job) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/jobs")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0 flex items-center gap-3">
          {logoAsset?.fileUrl ? (
            <img
              src={logoAsset.fileUrl}
              alt={logoAsset.altText ?? job.hiringPartner?.name ?? job.title}
              className="h-11 w-11 rounded-full border border-white/10 object-cover flex-shrink-0"
            />
          ) : (
            <div className="h-11 w-11 rounded-full border border-primary/30 bg-secondary/40 flex items-center justify-center text-base font-bold text-primary flex-shrink-0">
              {(job.hiringPartner?.name ?? job.title ?? "J").charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground truncate">{job.title}</h1>
            <p className="text-sm text-muted-foreground">{job.hiringPartner?.name ?? "Direct Hire"}</p>
          </div>
        </div>
        <StatusBadge status={job.status} domain="job" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Job Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="flex items-center gap-2 text-sm">
                  <Briefcase className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">Type:</span>
                  <span className="font-medium">{job.jobType?.replace(/_/g, " ") ?? "-"}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">Location:</span>
                  <span className="font-medium">{job.location ?? "-"}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">Expires:</span>
                  <span className="font-medium">{formatDate(job.closesAt)}</span>
                </div>
                {job.salaryMin != null && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Salary:</span>
                    <span className="font-medium">
                      {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(job.salaryMin)}
                      {job.salaryMax ? ` - ${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(job.salaryMax)}` : ""}
                    </span>
                  </div>
                )}
              </div>
              {job.description && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Description</p>
                  <p className="text-sm text-foreground whitespace-pre-line">{job.description}</p>
                </div>
              )}
              {job.requirements && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Requirements</p>
                  <p className="text-sm text-foreground whitespace-pre-line">{job.requirements}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Users className="h-4 w-4" />
                Applications
                <span className="text-muted-foreground">({applications?.total ?? 0})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                columns={applicationColumns}
                data={applications?.data ?? []}
                loading={appsLoading}
                emptyTitle="No applications yet"
                emptyDescription="Applications will appear here once candidates apply."
              />
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "Status", value: <StatusBadge status={job.status} domain="job" /> },
                { label: "Posted", value: formatDate(job.publishedAt) },
                { label: "Closes", value: formatDate(job.closesAt) },
                { label: "Applications", value: String(applications?.total ?? 0) },
                { label: "Hiring Partner", value: job.hiringPartner?.name ?? "Direct" },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <div className="mt-0.5 text-sm font-medium">{value}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
