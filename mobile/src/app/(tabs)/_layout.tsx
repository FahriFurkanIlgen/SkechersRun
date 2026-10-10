import { Tabs } from 'expo-router';
import { TabBar } from '../../components/TabBar';

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Harita' }} />
      <Tabs.Screen name="feed" options={{ title: 'Akış' }} />
      <Tabs.Screen name="quests" options={{ title: 'Görevler' }} />
      <Tabs.Screen name="leaderboard" options={{ title: 'Sıralama' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
