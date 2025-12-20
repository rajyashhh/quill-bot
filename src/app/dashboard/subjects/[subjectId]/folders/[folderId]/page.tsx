'use client'

import FileList from '@/components/FileList'
import { trpc } from '@/app/_trpc/client'

export const dynamic = 'force-dynamic'

interface PageProps {
    params: {
        subjectId: string
        folderId: string
    }
}

const Page = ({ params }: PageProps) => {
    const { subjectId, folderId } = params
    const { data: subfolder } = trpc.getSubfolder.useQuery({ id: folderId })

    return <FileList
        subjectId={subjectId}
        subfolderId={folderId}
        title={subfolder?.name || 'Folder'}
        backUrl={`/dashboard/subjects/${subjectId}`}
    />
}

export default Page
