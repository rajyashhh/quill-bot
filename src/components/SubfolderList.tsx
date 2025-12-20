'use client'

import { trpc } from '@/app/_trpc/client'
import CreateSubfolderDialog from './CreateSubfolderDialog'
import { Folder, ChevronRight, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { format } from 'date-fns'
import Skeleton from 'react-loading-skeleton'

interface SubfolderListProps {
    subjectId: string
    hideHeader?: boolean
}

const SubfolderList = ({ subjectId, hideHeader }: SubfolderListProps) => {
    const { data: subfolders, isLoading } = trpc.getSubfolders.useQuery({ subjectId })

    if (isLoading) {
        return <Skeleton height={60} count={2} className="mb-2" />
    }

    return (
        <div className="mb-8">
            {!hideHeader && (
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-gray-800">Folders</h2>
                    <CreateSubfolderDialog subjectId={subjectId} />
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {subfolders && subfolders.length > 0 ? (
                    subfolders.map((folder: any) => (
                        <Link
                            key={folder.id}
                            href={`/dashboard/subjects/${subjectId}/folders/${folder.id}`}
                            className="group flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg hover:shadow-md transition cursor-pointer"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-yellow-50 rounded-lg group-hover:bg-yellow-100 transition">
                                    <Folder className="h-6 w-6 text-yellow-500 fill-yellow-500" />
                                </div>
                                <div>
                                    <h3 className="font-medium text-gray-900 group-hover:text-primary transition">
                                        {folder.name}
                                    </h3>
                                    <p className="text-xs text-zinc-500">
                                        {folder._count.files} {folder._count.files === 1 ? 'file' : 'files'}
                                    </p>
                                </div>
                            </div>
                            <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-primary transition" />
                        </Link>
                    ))
                ) : (
                    <div className="col-span-full py-8 text-center border-2 border-dashed border-gray-200 rounded-lg">
                        <p className="text-zinc-500 text-sm">No folders yet</p>
                    </div>
                )}
            </div>
        </div>
    )
}

export default SubfolderList
