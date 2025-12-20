'use client'

import { trpc } from '@/app/_trpc/client'
import CreateSubjectDialog from './CreateSubjectDialog'
import { Ghost, FolderOpen, Book } from 'lucide-react'
import Skeleton from 'react-loading-skeleton'
import Link from 'next/link'
import { format } from 'date-fns'

const DashboardSubjects = () => {
    const { data: subjects, isLoading } = trpc.getSubjects.useQuery()

    return (
        <main className='mx-auto max-w-7xl md:p-10'>
            <div className='mt-8 flex flex-col items-start justify-between gap-4 border-b border-gray-200 pb-5 sm:flex-row sm:items-center sm:gap-0'>
                <h1 className='mb-3 font-bold text-5xl text-gray-900'>
                    Dashboard
                </h1>

                <CreateSubjectDialog />
            </div>

            <div className='mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3'>
                {/* Extras Folder */}
                <Link
                    href='/dashboard/extras'
                    className='col-span-1 rounded-lg bg-white shadow transition hover:shadow-lg border border-gray-200 p-6 flex flex-col items-center justify-center gap-4 cursor-pointer min-h-[150px]'
                >
                    <div className='p-3 bg-zinc-100 rounded-full'>
                        <FolderOpen className='h-8 w-8 text-zinc-600' />
                    </div>
                    <h3 className='text-xl font-semibold text-zinc-900'>Extras</h3>
                    <p className='text-zinc-500 text-sm'>Unassigned Files</p>
                </Link>

                {isLoading ? (
                    <Skeleton height={150} className='col-span-1' count={3} />
                ) : (
                    subjects?.map((subject) => (
                        <Link
                            key={subject.id}
                            href={`/dashboard/subjects/${subject.id}`}
                            className='col-span-1 rounded-lg bg-white shadow transition hover:shadow-lg border border-gray-200 p-6 flex flex-col justify-between cursor-pointer min-h-[150px]'
                        >
                            <div className="flex items-start justify-between">
                                <div className='p-3 bg-blue-50 rounded-full'>
                                    <Book className='h-8 w-8 text-blue-600' />
                                </div>
                            </div>

                            <div>
                                <h3 className='text-xl font-semibold text-zinc-900 truncate'>
                                    {subject.name}
                                </h3>
                                <div className="flex items-center justify-between mt-2">
                                    <p className='text-zinc-500 text-sm'>
                                        {subject._count.files} {subject._count.files === 1 ? 'file' : 'files'}
                                    </p>
                                    <p className='text-xs text-zinc-400'>
                                        {format(new Date(subject.createdAt), 'MMM yyyy')}
                                    </p>
                                </div>
                            </div>
                        </Link>
                    ))
                )}
            </div>

            {!isLoading && subjects?.length === 0 && (
                <div className='mt-16 flex flex-col items-center gap-2'>
                    <Ghost className='h-8 w-8 text-zinc-800' />
                    <h3 className='font-semibold text-xl'>
                        No subjects yet
                    </h3>
                    <p>Create a subject to get started.</p>
                </div>
            )}
        </main>
    )
}

export default DashboardSubjects
