import type { AgendaView } from '../components/AgendaViewTabs';
import { agendaMonth, agendaPeriod, agendaWeek, shiftCivilDate } from './agendaCalendar';

export function agendaViewPeriod(date: string, view: AgendaView, timezone: string) {
  shiftCivilDate(date, 0);
  if (view === 'month') return agendaMonth(date.slice(0, 7), timezone);
  const day = agendaPeriod(date, shiftCivilDate(date, 1), timezone);
  return view === 'week' ? agendaWeek(shiftCivilDate(date, -day.leading), timezone) : day;
}
