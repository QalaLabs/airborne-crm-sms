import { prisma } from "@/lib/db/client";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { CertificateDocument } from "@/components/lms/certificate-document";
import { getOptionalSession } from "@/lib/auth/session";

interface PageProps {
  params: Promise<{ certNo: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { certNo } = await params;
  return { title: `Certificate ${certNo} - Airborne Aviation` };
}

export default async function CertificatePrintPage({ params }: PageProps) {
  const { certNo } = await params;

  const user = await getOptionalSession();
  if (!user) {
    redirect("/login");
  }

  // Portal print is student-owned only. Require ownership + org isolation so a
  // student cannot render another student's certificate by knowing the certNo
  // or verificationCode.
  if (user.role !== "STUDENT") {
    notFound();
  }

  const cert = await prisma.lmsCertificate.findFirst({
    where: {
      OR: [{ certificateNo: certNo }, { verificationCode: certNo }],
      status: "ISSUED",
    },
    include: {
      student: { select: { id: true, userId: true, firstName: true, lastName: true, studentCode: true } },
      course: { select: { title: true } },
      org: { select: { id: true, name: true } },
      issuer: { select: { name: true } },
    },
  });

  if (
    !cert ||
    cert.orgId !== user.orgId ||
    cert.student.userId == null ||
    cert.student.userId !== user.id
  ) {
    notFound();
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
