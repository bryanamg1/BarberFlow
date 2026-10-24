import type { AgendaView } from '../components/AgendaViewTabs';
import { shiftCivilDate, shiftCivilMonth } from './agendaCalendar';

export function shiftAgendaDate(date: string, view: AgendaView, direction: -1 | 1) {
  return view === 'month'
    ? shiftCivilMonth(date, direction)
    : shiftCivilDate(date, direction * (view === 'week' ? 7 : 1));
}
