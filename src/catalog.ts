import type { MachineDraft } from './types';

export type CatalogMachine = Omit<MachineDraft, 'machineId' | 'stationCode' | 'status'>;

export const MACHINE_CATALOG: CatalogMachine[] = [
  { name: 'Power Rack', category: 'Multi-station', primaryMuscles: ['Full body'], assistingMuscles: ['Core'], instructions: ['Choose the exercise you are performing.', 'Set the J-hooks and safety arms before loading the bar.', 'Use collars and keep the rack area clear.'] },
  { name: 'Smith Machine', category: 'Multi-station', primaryMuscles: ['Full body'], assistingMuscles: ['Core'], instructions: ['Choose the exercise before logging.', 'Set the safety stops before loading the bar.', 'Keep the bar path controlled.'] },
  { name: 'Functional Trainer', category: 'Multi-station', primaryMuscles: ['Full body'], assistingMuscles: ['Core'], instructions: ['Choose the movement and set both pulleys evenly.', 'Select a controlled starting weight.', 'Keep the cable path clear.'] },
  { name: 'Hack Squat', category: 'Lower body', primaryMuscles: ['Quadriceps', 'Glutes'], assistingMuscles: ['Hamstrings', 'Adductors'], instructions: ['Place your feet securely on the platform.', 'Release the safety and lower with control.', 'Drive through your whole foot without locking the knees hard.'] },
  { name: 'Leg Press', category: 'Lower body', primaryMuscles: ['Quadriceps', 'Glutes'], assistingMuscles: ['Hamstrings', 'Adductors'], instructions: ['Set the seat so your hips stay supported.', 'Lower until you reach a controlled depth.', 'Press through your whole foot.'] },
  { name: 'Leg Extension', category: 'Lower body', primaryMuscles: ['Quadriceps'], assistingMuscles: [], instructions: ['Align your knee with the machine pivot.', 'Set the shin pad above the ankle.', 'Extend smoothly and lower with control.'] },
  { name: 'Seated Leg Curl', category: 'Lower body', primaryMuscles: ['Hamstrings'], assistingMuscles: ['Calves'], instructions: ['Align your knee with the machine pivot.', 'Secure the thigh pad without pinching.', 'Curl through a comfortable range and return slowly.'] },
  { name: 'Lying Leg Curl', category: 'Lower body', primaryMuscles: ['Hamstrings'], assistingMuscles: ['Calves'], instructions: ['Position your knees just beyond the bench edge.', 'Keep your hips against the pad.', 'Curl the pad toward your glutes and lower slowly.'] },
  { name: 'Hip Abductor', category: 'Lower body', primaryMuscles: ['Glute medius'], assistingMuscles: ['Glutes'], instructions: ['Set the pads against the outside of your knees.', 'Sit tall with your pelvis steady.', 'Press outward and return with control.'] },
  { name: 'Hip Adductor', category: 'Lower body', primaryMuscles: ['Adductors'], assistingMuscles: [], instructions: ['Set a comfortable starting width.', 'Sit tall and bring your knees inward.', 'Return slowly without letting the stack drop.'] },
  { name: 'Standing Calf Raise', category: 'Lower body', primaryMuscles: ['Calves'], assistingMuscles: ['Soleus'], instructions: ['Set the shoulder pads securely.', 'Keep the balls of your feet on the platform.', 'Rise fully, pause, and lower under control.'] },
  { name: 'Seated Calf Raise', category: 'Lower body', primaryMuscles: ['Soleus'], assistingMuscles: ['Calves'], instructions: ['Secure the thigh pad above your knees.', 'Keep the balls of your feet on the platform.', 'Raise your heels fully and lower slowly.'] },
  { name: 'Chest Press', category: 'Chest', primaryMuscles: ['Chest'], assistingMuscles: ['Triceps', 'Front deltoids'], instructions: ['Set the seat so the handles align with mid-chest.', 'Keep your shoulders against the pad.', 'Press smoothly and return with control.'] },
  { name: 'Incline Chest Press', category: 'Chest', primaryMuscles: ['Upper chest'], assistingMuscles: ['Triceps', 'Front deltoids'], instructions: ['Set the seat so the handles begin near upper chest.', 'Keep your shoulder blades supported.', 'Press up and forward without shrugging.'] },
  { name: 'Pec Deck', category: 'Chest', primaryMuscles: ['Chest'], assistingMuscles: ['Front deltoids'], instructions: ['Set the seat so your elbows align near chest height.', 'Keep a soft bend in your elbows.', 'Bring the pads together and return slowly.'] },
  { name: 'Lat Pulldown', category: 'Back', primaryMuscles: ['Latissimus dorsi'], assistingMuscles: ['Biceps', 'Upper back'], instructions: ['Secure your thighs under the pad.', 'Pull the bar toward your upper chest.', 'Return overhead without losing control.'] },
  { name: 'Seated Row', category: 'Back', primaryMuscles: ['Upper back', 'Latissimus dorsi'], assistingMuscles: ['Biceps', 'Rear deltoids'], instructions: ['Set the chest pad or foot position securely.', 'Row toward your lower ribs.', 'Reach forward under control without rounding hard.'] },
  { name: 'Back Extension', category: 'Back', primaryMuscles: ['Lower back'], assistingMuscles: ['Glutes', 'Hamstrings'], instructions: ['Set the pad below your hips.', 'Brace and hinge through a comfortable range.', 'Return to neutral without overextending.'] },
  { name: 'Shoulder Press', category: 'Shoulders', primaryMuscles: ['Deltoids'], assistingMuscles: ['Triceps', 'Upper chest'], instructions: ['Set the seat so the handles start near shoulder height.', 'Keep your back supported.', 'Press overhead without shrugging.'] },
  { name: 'Lateral Raise', category: 'Shoulders', primaryMuscles: ['Side deltoids'], assistingMuscles: ['Upper traps'], instructions: ['Align your shoulders with the machine pivot.', 'Raise to a comfortable shoulder height.', 'Lower without letting the stack drop.'] },
  { name: 'Biceps Curl', category: 'Arms', primaryMuscles: ['Biceps'], assistingMuscles: ['Forearms'], instructions: ['Align your elbows with the pivot.', 'Keep your upper arms supported.', 'Curl fully and lower slowly.'] },
  { name: 'Triceps Extension', category: 'Arms', primaryMuscles: ['Triceps'], assistingMuscles: [], instructions: ['Set your elbows comfortably against the pad.', 'Extend without lifting your shoulders.', 'Return with control.'] },
  { name: 'Assisted Pull-Up / Dip', category: 'Upper body', primaryMuscles: ['Back', 'Chest'], assistingMuscles: ['Biceps', 'Triceps'], instructions: ['Select enough assistance for control.', 'Choose pull-up or dip before logging.', 'Step off carefully after the set.'] },
  { name: 'Cable Crossover', category: 'Multi-station', primaryMuscles: ['Chest'], assistingMuscles: ['Shoulders', 'Triceps'], instructions: ['Set both pulley heights evenly.', 'Choose the cable movement before logging.', 'Keep the cable path clear.'] },
  { name: 'Glute Drive', category: 'Lower body', primaryMuscles: ['Glutes'], assistingMuscles: ['Hamstrings'], instructions: ['Secure the belt or pad across your hips.', 'Plant your feet and brace.', 'Drive your hips up and lower with control.'] }
];

export function draftFromCatalog(item: CatalogMachine, stationCode: string): MachineDraft {
  return { ...item, stationCode, status: 'active' };
}
