// Icons from the Orbyn Planner screen designs (24px grid, drawn with a 1.6px stroke).
export const ICONS = {
  search: "<circle cx=\"11\" cy=\"11\" r=\"6.5\"/><path d=\"M16 16l4.5 4.5\"/>",
  home: "<path d=\"M4 11l8-6.5 8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z\"/><path d=\"M9.5 20.5v-6h5v6\"/>",
  check: "<rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"3.5\"/><path d=\"M8.5 12.5l2.5 2.5 4.5-5\"/>",
  cal: "<rect x=\"3.5\" y=\"5\" width=\"17\" height=\"15.5\" rx=\"2.5\"/><path d=\"M3.5 10h17M8 3v4M16 3v4\"/>",
  list: "<path d=\"M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01\"/>",
  folder: "<path d=\"M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z\"/>",
  bell: "<path d=\"M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z\"/><path d=\"M10 20.5h4\"/>",
  gear: "<path d=\"M4 7h9M17 7h3M4 17h3M11 17h9\"/><circle cx=\"15\" cy=\"7\" r=\"2\"/><circle cx=\"9\" cy=\"17\" r=\"2\"/>",
  plus: "<path d=\"M12 5v14M5 12h14\"/>",
  x: "<path d=\"M7 7l10 10M17 7L7 17\"/>",
  left: "<path d=\"M14.5 6l-6 6 6 6\"/>",
  right: "<path d=\"M9.5 6l6 6-6 6\"/>",
  down: "<path d=\"M7 10l5 5 5-5\"/>",
  up: "<path d=\"M12 19V5M6.5 10.5L12 5l5.5 5.5\"/>",
  edit: "<path d=\"M4 20h4L19 9l-4-4L4 16z\"/>",
  eye: "<path d=\"M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z\"/><circle cx=\"12\" cy=\"12\" r=\"2.8\"/>",
  users: "<circle cx=\"9\" cy=\"8.5\" r=\"3.2\"/><path d=\"M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5\"/><path d=\"M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.8c1.5.6 2.6 2 3 4.2\"/>",
  clip: "<path d=\"M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7.2\"/>",
  inbox: "<path d=\"M3.5 13.5l2.5-8h12l2.5 8V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z\"/><path d=\"M3.5 13.5h5l1 2h5l1-2h5\"/>",
  more: "<path d=\"M6 12h.01M12 12h.01M18 12h.01\"/>",
  pin: "<path d=\"M9 4h6l-1 5 3 3H7l3-3zM12 12v8\"/>",
} as const;

export type IconName = keyof typeof ICONS;
