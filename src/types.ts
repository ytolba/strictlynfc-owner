export type OwnerRole = 'owner' | 'manager' | 'viewer';

export type MachineTag = {
  publicId: string;
  labelCode: string;
  type: 'ntag213' | 'ntag215' | 'ntag216';
  status: 'unassigned' | 'active' | 'disabled' | 'replaced';
};

export type Machine = {
  id: string;
  name: string;
  category: string;
  stationCode: string;
  status: 'active' | 'maintenance' | 'retired';
  primaryMuscles: string[];
  assistingMuscles: string[];
  instructions: string[];
  videoUrl?: string | null;
  taps7Days: number;
  taps30Days: number;
  lastTapAt?: string | null;
  tags: MachineTag[];
};

export type DashboardData = {
  gym: { id: string; name: string; slug?: string };
  access: { role: OwnerRole };
  accessibleGyms: { id: string; name: string }[];
  summary: { tapsToday: number; taps7Days: number; taps30Days: number; activeTagCount: number; machineCount: number };
  dailyActivity: { date: string; taps: number }[];
  machines: Machine[];
};

export type MachineDraft = {
  machineId?: string | null;
  name: string;
  stationCode: string;
  category: string;
  status: Machine['status'];
  primaryMuscles: string[];
  assistingMuscles: string[];
  instructions: string[];
};

export type ProvisioningDraft = {
  machineId: string;
  machineName: string;
  publicId: string;
  labelCode: string;
  tagType: MachineTag['type'];
  url: string;
};
