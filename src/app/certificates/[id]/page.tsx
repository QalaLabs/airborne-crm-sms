import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { CertificateDocument } from "@/components/lms/certificate-document";
import { getOptionalSession } from "@/lib/auth/session";
import { getRequestContext } from "@/lib/middleware/context";
import { LmsService } from "@/lib/services/lms.service";
import { roleCan } from "@/lib/utils/permissions";
import { NotFoundError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Certificate - Airborne Aviation" };

interface PageProps {
  params: Promise<{ id: string }>;
}

/** Authenticated certificate view for staff (and the owning student) by certificate id. */
export default async function CertificateViewPage({ params }: PageProps) {
  const { id } = await params;

  const user = await getOptionalSession();
  if (!user) redirect("/login");
  if (!roleCan(user.role, "read", "lms_certificates")) notFound();

  let cert;
  try {
    cert = await LmsService.getCertificate(await getRequestContext(), id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  return (
    <CertificateDocument
      cert={{
        orgName: cert.org.name,
        studentName: `${cert.student.firstName} ${cert.student.lastName}`,
        studentCode: cert.student.studentCode,
        courseTitle: cert.course.title,
        issuedAt: cert.issuedAt,
        issuerName: cert.issuer?.name ?? null,
        certificateNo: cert.certificateNo,
        verificationCode: cert.verificationCode,
        status: cert.status,
      }}
    />
  );
}
