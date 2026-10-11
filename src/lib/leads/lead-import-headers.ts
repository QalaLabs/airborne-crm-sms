// Client-safe (no Prisma import): shared by the upload dialog and the server.

export const MAX_IMPORT_ROWS = 2000;

export type ImportField =
  | "name" | "phone" | "email" | "courseInterest" | "city" | "state" | "pincode"
  | "source" | "status" | "counselorEmail" | "createdAt" | "notes";

// Header aliases → canonical field. Matching is case/space/punctuation-insensitive.
const HEADER_ALIASES: Record<string, ImportField> = {
  name: "name", fullname: "name", studentname: "name", leadname: "name", candidatename: "name",
  phone: "phone", mobile: "phone", mobileno: "phone", mobilenumber: "phone", phonenumber: "phone", contact: "phone", contactnumber: "phone", whatsapp: "phone",
  email: "email", emailid: "email", emailaddress: "email", mail: "email",
  course: "courseInterest", courseinterest: "courseInterest", interestedcourse: "courseInterest", program: "courseInterest",
  city: "city", location: "city",
  state: "state",
  pincode: "pincode", pin: "pincode", zipcode: "pincode", zip: "pincode",
  source: "source", leadsource: "source", channel: "source",
  status: "status", leadstatus: "status", stage: "status",
  counselor: "counselorEmail", counsellor: "counselorEmail", counseloremail: "counselorEmail", counselloremail: "counselorEmail", assignedto: "counselorEmail",
  date: "createdAt", createdat: "createdAt", createddate: "createdAt", enquirydate: "createdAt", leaddate: "createdAt",
  notes: "notes", note: "notes", remarks: "notes", comments: "notes", remark: "notes",
};

export function canonicalHeader(header: string): ImportField | undefined {
  const key = header.toLowerCase().replace(/[^a-z]/g, "");
  return HEADER_ALIASES[key];
}
