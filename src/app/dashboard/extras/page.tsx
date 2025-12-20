import FileList from '@/components/FileList'

export const dynamic = 'force-dynamic'

const Page = () => {
    return <FileList subjectId={null} title="Extras" backUrl="/dashboard" />
}

export default Page
