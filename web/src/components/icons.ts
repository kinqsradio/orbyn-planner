// Icons from the Orbyn Planner screen designs (24px grid, drawn with a 1.6px stroke).
// Each icon is a list of SVG shapes, rendered as JSX: no HTML strings.
export type IconShape =
  | { t: "path"; d: string }
  | { t: "circle"; cx: string; cy: string; r: string }
  | { t: "rect"; x: string; y: string; width: string; height: string; rx?: string };

export const ICONS = {
  search: [{"t":"circle","cx":"11","cy":"11","r":"6.5"},{"t":"path","d":"M16 16l4.5 4.5"}],
  home: [{"t":"path","d":"M4 11l8-6.5 8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z"},{"t":"path","d":"M9.5 20.5v-6h5v6"}],
  check: [{"t":"rect","x":"4","y":"4","width":"16","height":"16","rx":"3.5"},{"t":"path","d":"M8.5 12.5l2.5 2.5 4.5-5"}],
  cal: [{"t":"rect","x":"3.5","y":"5","width":"17","height":"15.5","rx":"2.5"},{"t":"path","d":"M3.5 10h17M8 3v4M16 3v4"}],
  list: [{"t":"path","d":"M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"}],
  folder: [{"t":"path","d":"M3.5 7.5a2 2 0 0 1 2-2h3.8l2 2h7.2a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"}],
  bell: [{"t":"path","d":"M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"},{"t":"path","d":"M10 20.5h4"}],
  gear: [{"t":"path","d":"M4 7h9M17 7h3M4 17h3M11 17h9"},{"t":"circle","cx":"15","cy":"7","r":"2"},{"t":"circle","cx":"9","cy":"17","r":"2"}],
  plus: [{"t":"path","d":"M12 5v14M5 12h14"}],
  x: [{"t":"path","d":"M7 7l10 10M17 7L7 17"}],
  left: [{"t":"path","d":"M14.5 6l-6 6 6 6"}],
  right: [{"t":"path","d":"M9.5 6l6 6-6 6"}],
  down: [{"t":"path","d":"M7 10l5 5 5-5"}],
  up: [{"t":"path","d":"M12 19V5M6.5 10.5L12 5l5.5 5.5"}],
  edit: [{"t":"path","d":"M4 20h4L19 9l-4-4L4 16z"}],
  eye: [{"t":"path","d":"M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"},{"t":"circle","cx":"12","cy":"12","r":"2.8"}],
  users: [{"t":"circle","cx":"9","cy":"8.5","r":"3.2"},{"t":"path","d":"M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5"},{"t":"path","d":"M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.8c1.5.6 2.6 2 3 4.2"}],
  clip: [{"t":"path","d":"M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7.2"}],
  inbox: [{"t":"path","d":"M3.5 13.5l2.5-8h12l2.5 8V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"},{"t":"path","d":"M3.5 13.5h5l1 2h5l1-2h5"}],
  more: [{"t":"path","d":"M6 12h.01M12 12h.01M18 12h.01"}],
  pin: [{"t":"path","d":"M9 4h6l-1 5 3 3H7l3-3zM12 12v8"}],
  shield: [{"t":"path","d":"M12 3.5l7 2.8v5.4c0 4.3-3 7.5-7 8.8-4-1.3-7-4.5-7-8.8V6.3z"}],
  laptop: [{"t":"rect","x":"5","y":"5","width":"14","height":"10","rx":"1.5"},{"t":"path","d":"M3 18.5h18"}],
  alert: [{"t":"path","d":"M12 4l9 15.5H3z"},{"t":"path","d":"M12 10v4M12 17h.01"}],
  info: [{"t":"circle","cx":"12","cy":"12","r":"8.5"},{"t":"path","d":"M12 11v5M12 8h.01"}],
  lock: [{"t":"rect","x":"5","y":"10.5","width":"14","height":"9.5","rx":"2"},{"t":"path","d":"M8 10.5V8a4 4 0 0 1 8 0v2.5"}],
} satisfies Record<string, IconShape[]>;

export type IconName = keyof typeof ICONS;
