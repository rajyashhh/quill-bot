import AnalyticsClient from './AnalyticsClient'

interface AnalyticsPageProps {
  params: {
    fileid: string
  }
}

export default function AnalyticsPage({ params }: AnalyticsPageProps) {
  return <AnalyticsClient fileId={params.fileid} />
}
