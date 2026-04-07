export type UserRole = 'admin' | 'advocate' | 'clerk' | 'client';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  phoneNumber?: string;
  firmName?: string;
  createdAt: string;
}

export type CaseStatus = 'open' | 'pending_payment' | 'active' | 'closed' | 'archived';

export interface LegalCase {
  id: string;
  caseNumber: string;
  title: string;
  description: string;
  status: CaseStatus;
  clientUid: string;
  assignedAdvocateUid?: string;
  practiceArea: string;
  createdAt: string;
  updatedAt: string;
}

export type DocumentType = 'affidavit' | 'lease' | 'nda' | 'sale_agreement' | 'other';
export type DocumentStatus = 'draft' | 'review' | 'signed' | 'filed';

export interface LegalDocument {
  id: string;
  caseId: string;
  title: string;
  content: string;
  type: DocumentType;
  status: DocumentStatus;
  createdByUid: string;
  createdAt: string;
}

export type PaymentStatus = 'pending' | 'completed' | 'failed';

export interface PaymentRecord {
  id: string;
  caseId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  pesapalTrackingId?: string;
  pesapalMerchantReference: string;
  clientUid: string;
  createdAt: string;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  content: string; // Markdown with {{variable}} placeholders
  category: string;
  variables: string[]; // List of dynamic fields
  createdByUid: string;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  uid: string;
  action: string;
  details: string;
  timestamp: string;
}

export interface CaseActivity {
  id: string;
  caseId: string;
  uid: string;
  action: string;
  details: string;
  timestamp: string;
}
