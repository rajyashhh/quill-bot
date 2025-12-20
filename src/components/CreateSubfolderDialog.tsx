'use client'

import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { trpc } from '@/app/_trpc/client'
import { Loader2, FolderPlus } from 'lucide-react'
import { useToast } from './ui/use-toast'

interface CreateSubfolderDialogProps {
    subjectId: string
}

const CreateSubfolderDialog = ({ subjectId }: CreateSubfolderDialogProps) => {
    const [isOpen, setIsOpen] = useState(false)
    const [name, setName] = useState('')
    const { toast } = useToast()
    const utils = trpc.useContext()

    const { mutate: createSubfolder, isLoading } = trpc.createSubfolder.useMutation({
        onSuccess: () => {
            setIsOpen(false)
            setName('')
            utils.getSubfolders.invalidate({ subjectId })
            toast({
                title: 'Success',
                description: 'Subfolder created successfully',
            })
        },
        onError: () => {
            toast({
                title: 'Error',
                description: 'Failed to create subfolder',
                variant: 'destructive',
            })
        },
    })

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                    <FolderPlus className="h-4 w-4" />
                    New Folder
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create New Folder</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-4">
                    <Input
                        placeholder="Folder Name (e.g. Chapter 1)"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    <Button
                        onClick={() => createSubfolder({ name, subjectId })}
                        disabled={isLoading || !name.trim()}
                    >
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Create
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export default CreateSubfolderDialog
