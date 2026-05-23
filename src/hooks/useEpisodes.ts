import { useQuery } from '@tanstack/react-query';
import { episodeService } from '@services/episodeService';
import { useAuthStore } from '@stores/authStore';

export function useTodayBriefing() {
  const uid = useAuthStore((s) => s.user?.uid);

  return useQuery({
    queryKey: ['briefing', 'today', uid],
    queryFn:  () => episodeService.getTodayBriefing(uid!),
    enabled:  !!uid,
    staleTime: 1000 * 60 * 5,
  });
}

export function useEpisodes(type?: 'daily_brief' | 'deepcast' | 'live_station') {
  const uid = useAuthStore((s) => s.user?.uid);

  return useQuery({
    queryKey: ['episodes', type ?? 'all', uid],
    queryFn:  () => episodeService.getEpisodes(uid!, { type }),
    enabled:  !!uid,
    staleTime: 1000 * 60 * 3,
  });
}
