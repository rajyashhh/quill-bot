'use client'

import FileList from '@/components/FileList'
import SubfolderList from '@/components/SubfolderList'
import { trpc } from '@/app/_trpc/client'

import CreateSubfolderDialog from '@/components/CreateSubfolderDialog'

export const dynamic = 'force-dynamic'

interface PageProps {
    params: {
        subjectId: string
    }
}



const Page = ({ params }: PageProps) => {
    const { subjectId } = params
    const { data: subject } = trpc.getSubject.useQuery({ id: subjectId })

    return (
        <FileList
            subjectId={subjectId}
            title={subject?.name || 'Subject'}
            backUrl="/dashboard"
            additionalActions={<CreateSubfolderDialog subjectId={subjectId} />}
        >
            <SubfolderList subjectId={subjectId} hideHeader />
        </FileList>
    )
}

export default Page
