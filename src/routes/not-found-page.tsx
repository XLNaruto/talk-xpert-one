import { Link } from 'react-router-dom'
import { buttonVariants } from '@/components/ui/button'
import { EmptyState } from '@/components/common/empty-state'

export function NotFoundPage() {
  return (
    <div className="h-full bg-background">
      <EmptyState
        title="Page not found"
        description="That address doesn't exist in One Talk."
        action={
          <Link to="/chat" className={buttonVariants()}>
            Back to conversations
          </Link>
        }
      />
    </div>
  )
}
