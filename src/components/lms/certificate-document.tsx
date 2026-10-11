import { PrintButton } from "@/components/lms/print-button";

export interface CertificateDocumentData {
  orgName: string;
  studentName: string;
  studentCode: string;
  courseTitle: string;
  issuedAt: Date | null;
  issuerName: string | null;
  certificateNo: string;
  verificationCode: string | null;
  status: string;
}

/** Shared certificate rendering for the student portal print view and the staff view. */
export function CertificateDocument({ cert }: { cert: CertificateDocumentData }) {
  const issuedDate = cert.issuedAt
    ? new Date(cert.issuedAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    : "";

  return (
    <div
      style={{
        fontFamily: "Georgia, 'Times New Roman', serif",
        background: "linear-gradient(135deg, #0b1f3a 0%, #162d54 100%)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px",
        color: "#fff",
      }}
    >
      {/* Actions (hidden on print) */}
      <div
        className="no-print"
        style={{ marginBottom: "20px", display: "flex", gap: "12px" }}
      >
        <PrintButton />
      </div>

      {/* Certificate card */}
      <div
        data-testid="certificate-document"
        style={{
          width: "100%", maxWidth: "840px",
          background: "linear-gradient(135deg, #0b1f3a 0%, #1a3a6b 100%)",
          border: "2px solid rgba(200,16,46,0.35)",
          borderRadius: "16px",
          padding: "60px 72px",
          position: "relative",
          textAlign: "center",
          boxShadow: "0 20px 80px rgba(0,0,0,0.4)",
        }}
      >
        {/* Inner border */}
        <div style={{
          position: "absolute", inset: "10px", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "10px", pointerEvents: "none",
        }} />

        {cert.status !== "ISSUED" && (
          <div data-testid="certificate-status-banner" style={{ marginBottom: "16px", padding: "6px 12px", borderRadius: "6px", background: "rgba(200,16,46,0.25)", fontFamily: "system-ui", fontSize: "12px", letterSpacing: "0.2em", textTransform: "uppercase" }}>
            {cert.status === "REVOKED" ? "Revoked - not valid" : "Draft - not issued"}
          </div>
        )}

        {/* Org */}
        <div style={{ marginBottom: "6px" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: "56px", height: "56px", borderRadius: "14px",
            background: "#c8102e", marginBottom: "14px",
            fontSize: "24px",
          }}>
            ✈
          </div>
          <p style={{ fontSize: "11px", letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", fontFamily: "system-ui" }}>
            {cert.orgName}
          </p>
        </div>

        <p style={{ fontSize: "10px", letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", marginBottom: "28px", fontFamily: "system-ui" }}>
          Certificate of Completion
        </p>

        <p style={{ fontSize: "15px", color: "rgba(255,255,255,0.65)", marginBottom: "10px", fontFamily: "system-ui" }}>This is to certify that</p>

        <h1 style={{
          fontSize: "38px", fontWeight: 700, color: "#fff",
          marginBottom: "6px", lineHeight: 1.2,
          textShadow: "0 2px 20px rgba(200,16,46,0.3)",
        }}>
          {cert.studentName}
        </h1>
        <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", marginBottom: "28px", fontFamily: "monospace" }}>
          Student ID: {cert.studentCode}
        </p>

        <p style={{ fontSize: "15px", color: "rgba(255,255,255,0.65)", marginBottom: "6px", fontFamily: "system-ui" }}>has successfully completed</p>

        <h2 style={{
          fontSize: "26px", fontWeight: 700, color: "#fff",
          marginBottom: "36px", lineHeight: 1.3,
          textShadow: "0 1px 12px rgba(200,16,46,0.2)",
        }}>
          {cert.courseTitle}
        </h2>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "36px", justifyContent: "center" }}>
          <div style={{ flex: 1, maxWidth: "100px", height: "1px", background: "rgba(200,16,46,0.45)" }} />
          <div style={{ width: "8px", height: "8px", background: "#c8102e", transform: "rotate(45deg)", borderRadius: "1px" }} />
          <div style={{ flex: 1, maxWidth: "100px", height: "1px", background: "rgba(200,16,46,0.45)" }} />
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", fontFamily: "system-ui" }}>
          <div style={{ textAlign: "left" }}>
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Date of Issue</p>
            <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.8)", fontWeight: 600 }}>{issuedDate}</p>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{
              width: "72px", height: "72px", borderRadius: "50%",
              border: "2px solid rgba(200,16,46,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 6px", fontSize: "28px",
            }}>
              ✈
            </div>
            <p style={{ fontSize: "9px", color: "rgba(255,255,255,0.3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Official Seal</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.2)", paddingTop: "6px", minWidth: "130px" }}>
              <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.8)", fontWeight: 600 }}>{cert.issuerName ?? "Airborne Academy"}</p>
              <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Authorised Signatory</p>
            </div>
          </div>
        </div>

        {/* Cert No */}
        <div style={{
          marginTop: "28px", padding: "10px 20px", borderRadius: "8px",
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
          fontFamily: "monospace", fontSize: "11px", color: "rgba(255,255,255,0.4)",
        }}>
          CERTIFICATE NO: <span style={{ color: "rgba(255,255,255,0.7)" }}>{cert.certificateNo}</span>
          {cert.verificationCode && (
            <> &nbsp;·&nbsp; VERIFICATION: <span style={{ color: "rgba(255,255,255,0.7)" }}>{cert.verificationCode}</span></>
          )}
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: transparent !important; }
        }
      `}</style>
    </div>
  );
}
