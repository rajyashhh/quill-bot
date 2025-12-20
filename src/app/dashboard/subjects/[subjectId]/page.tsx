'use client'

import FileList from '@/components/FileList'
import SubfolderList from '@/components/SubfolderList'
import { trpc } from '@/app/_trpc/client'

interface PageProps {
    params: {
        subjectId: string
    }
}

import CreateSubfolderDialog from '@/components/CreateSubfolderDialog'

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
