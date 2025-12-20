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
import { Loader2, Plus } from 'lucide-react'
import { useToast } from './ui/use-toast'

const CreateSubjectDialog = () => {
    const [isOpen, setIsOpen] = useState(false)
    const [name, setName] = useState('')
    const { toast } = useToast()
    const utils = trpc.useContext()

    const { mutate: createSubject, isLoading } = trpc.createSubject.useMutation({
        onSuccess: () => {
            setIsOpen(false)
            setName('')
            utils.getSubjects.invalidate()
            toast({
                title: 'Success',
                description: 'Subject created successfully',
            })
        },
        onError: () => {
            toast({
                title: 'Error',
                description: 'Failed to create subject',
                variant: 'destructive',
            })
        },
    })

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Subject
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create New Subject</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-4">
                    <Input
                        placeholder="Subject Name (e.g. Mathematics)"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                    <Button
                        onClick={() => createSubject({ name })}
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

export default CreateSubjectDialog
