export type ExerciseOption = {
  slug: string;
  name: string;
  category: string;
  primaryMuscles: string[];
  assistingMuscles: string[];
  instructions: string[];
  videoUrl?: string | null;
};

export type MemberMachine = {
  publicId: string;
  name: string;
  stationName?: string | null;
  stationCode: string;
  gymName: string;
  category: string;
  primaryMuscles: string[];
  assistingMuscles: string[];
  instructions: string[];
  videoUrl?: string | null;
  stationType?: 'single_exercise' | 'multi_exercise';
  exerciseSlug?: string | null;
  exercises?: ExerciseOption[];
};

export type PartnerGym = {
  id: string;
  slug: string;
  name: string;
  address: string;
  city: string;
  region: string;
  latitude: number;
  longitude: number;
  equipmentCount: number;
  logoUrl?: string | null;
  accentColor: string;
  backgroundColor: string;
};

export type EquipmentSummary = {
  publicId: string;
  name: string;
  category: string;
  stationCode: string;
};

export type WorkoutSet = {
  clientLogId: string;
  workoutSessionId?: string | null;
  publicId: string;
  machineName: string;
  exerciseSlug?: string | null;
  exerciseName?: string | null;
  gymName: string;
  weight: number;
  reps: number;
  seatSetting?: string | null;
  notes?: string | null;
  createdAt: string;
  syncState: 'pending' | 'synced';
};

export type WorkoutSession = {
  id: string;
  gymId: string;
  gymName: string;
  startedAt: string;
  finishedAt?: string | null;
  sets: WorkoutSet[];
  cloudSynced?: boolean;
};

export type MachineHistoryItem = {
  id?: string;
  client_log_id?: string | null;
  weight_lb: number;
  reps: number;
  seat_setting?: string | null;
  notes?: string | null;
  occurred_at: string;
};

export type MemberPreferences = {
  favoriteGymIds: string[];
  weightUnit: 'lb' | 'kg';
  healthKitEnabled?: boolean;
};
