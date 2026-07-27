export type BackgroundTemplate = {
  id: string;
  file_name: string;
  width: number;
  height: number;
  file_size: number;
  calibrated: boolean;
  created_at: string;
  a4_x1: number | null;
  a4_y1: number | null;
  a4_x2: number | null;
  a4_y2: number | null;
  a4_x3: number | null;
  a4_y3: number | null;
  a4_x4: number | null;
  a4_y4: number | null;
};

export type CalibrationCorners = [
  number, number,
  number, number,
  number, number,
  number, number,
];
