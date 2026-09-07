import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/auth/LoginPage'
import { isAuthenticated } from './lib/auth'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" replace />
}
import { SurveyListPage } from './pages/surveys/SurveyListPage'
import { NewSurveyPage } from './pages/surveys/NewSurveyPage'
import { PromptEditorPage } from './pages/surveys/PromptEditorPage'
import { QuotaEditorPage } from './pages/quotas/QuotaEditorPage'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { CampaignsPage } from './pages/campaigns/CampaignsPage'
import { CampaignDetailPage } from './pages/campaigns/CampaignDetailPage'
import { CampaignAgentPromptPage } from './pages/campaigns/CampaignAgentPromptPage'
import { QuotaInsightPage } from './pages/campaigns/QuotaInsightPage'
import { PhoneNumbersPage } from './pages/phone-numbers/PhoneNumbersPage'
import { AgentsPage } from './pages/agents/AgentsPage'
import { CallHistoryPage } from './pages/call-history/CallHistoryPage'
import { InboundRoutingPage } from './pages/inbound-routing/InboundRoutingPage'
import { AnalyticsDashboard } from './pages/analytics/AnalyticsDashboard'
import { ImportPage } from './pages/import/ImportPage'
import { CaseStudyPage } from './pages/case-study/CaseStudyPage'

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="campaigns" element={<CampaignsPage />} />
          <Route path="campaigns/:id/agent-prompt" element={<CampaignAgentPromptPage />} />
          <Route path="campaigns/:id" element={<CampaignDetailPage />} />
          <Route path="campaigns/:id/quota-insight" element={<QuotaInsightPage />} />
          <Route path="phone-numbers" element={<PhoneNumbersPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="call-history" element={<CallHistoryPage />} />
          <Route path="case-study" element={<CaseStudyPage />} />
          <Route path="inbound-routing" element={<InboundRoutingPage />} />
          <Route path="dashboard" element={<AnalyticsDashboard />} />
          <Route path="surveys" element={<SurveyListPage />} />
          <Route path="surveys/new" element={<NewSurveyPage />} />
          <Route path="surveys/:id/prompt" element={<PromptEditorPage />} />
          <Route path="surveys/:id/quotas" element={<QuotaEditorPage />} />
          <Route path="surveys/:id/dashboard" element={<DashboardPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="import" element={<ImportPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
